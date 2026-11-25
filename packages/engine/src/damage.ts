import { calculate, Field, Move, Pokemon, type State } from '@smogon/calc';
import { getFinalSpeed } from '@smogon/calc/dist/mechanics/util.js';
import { calcGen, dex } from './data/dex.js';
import { megaFormeOf } from './legality.js';
import type { Build, StatTable } from './build.js';
import type { Regulation } from './rules/regulation.js';

/**
 * Damage = @smogon/calc (Champions mechanics, gen 0) + the regulation's balance overrides.
 * Probabilities (OHKO, 2HKO...) are computed here EXACTLY from the 16 damage rolls,
 * crit chance and accuracy — no sampling, no LLM.
 */

export interface CombatantOptions {
  /** Use the mega forme (requires the Mega Stone). Default: true when holding one. */
  mega?: boolean;
  boosts?: Partial<StatTable>;
  status?: State.Pokemon['status'];
  curHPPercent?: number; // 0-100
  abilityOn?: boolean;
}

export function toCalcPokemon(build: Build, reg: Regulation, opts: CombatantOptions = {}): Pokemon {
  const megaForme = megaFormeOf(build);
  const useMega = opts.mega ?? !!megaForme;
  const name = useMega && megaForme ? megaForme : build.species;
  const speciesOverride = reg.pack.overrides.species[name];
  const p = new Pokemon(calcGen, name, {
    level: reg.format('doubles').level.value,
    ability: useMega && megaForme ? undefined : build.ability, // mega formes have their own ability
    item: build.item,
    nature: build.alignment,
    evs: build.sp, // in calc gen 0, "evs" are Stat Points
    boosts: opts.boosts,
    status: opts.status,
    abilityOn: opts.abilityOn,
    moves: build.moves,
    overrides: speciesOverride?.baseStats ? ({ baseStats: speciesOverride.baseStats } as never) : undefined,
  });
  if (opts.curHPPercent !== undefined) {
    p.originalCurHP = Math.max(1, Math.floor((p.maxHP() * opts.curHPPercent) / 100));
  }
  return p;
}

export function makeMove(name: string, reg: Regulation, opts: { isCrit?: boolean; isSpread?: boolean } = {}): Move {
  const o = reg.pack.overrides.moves[name];
  return new Move(calcGen, name, {
    isCrit: opts.isCrit,
    overrides: o ? ({ ...(o.basePower !== undefined && { basePower: o.basePower }), ...(o.type && { type: o.type }) } as never) : undefined,
  });
}

export type FieldInput = Partial<State.Field>;

export interface DamageResult {
  attacker: string;
  defender: string;
  move: string;
  defenderHP: number;
  /** Damage rolls (16 for single-hit moves; distinct possible totals for multi-hit moves). */
  rolls: number[];
  critRolls: number[];
  min: number;
  max: number;
  minPct: number;
  maxPct: number;
  /** Expected damage of one use: includes accuracy and crit chance. */
  expected: number;
  accuracy: number; // 0-1
  critChance: number; // 0-1
  /** P(KO within n uses), n = 1..4, from full HP (or curHP), no residual damage/recovery. */
  koChance: [number, number, number, number];
  description: string;
  assumptions: string[];
}

/** Crit probability by crit stage (gen 7+ table, used by Champions). */
export function critChanceForStage(stage: number): number {
  if (stage <= 0) return 1 / 24;
  if (stage === 1) return 1 / 8;
  if (stage === 2) return 1 / 2;
  return 1;
}

export type Dist = Map<number, number>;

/** Exact damage distribution of one hit-sequence: single-hit = 16 equiprobable rolls; multi-hit = convolution per hit. */
export function distOf(damage: number | number[] | number[][]): Dist {
  const hits: number[][] =
    typeof damage === 'number' ? [[damage]] : Array.isArray(damage[0]) ? (damage as number[][]) : [damage as number[]];
  let dist: Dist = new Map([[0, 1]]);
  for (const hit of hits) {
    const next: Dist = new Map();
    for (const [d, p] of dist) for (const r of hit) next.set(d + r, (next.get(d + r) ?? 0) + p / hit.length);
    dist = next;
  }
  return dist;
}

const distMin = (d: Dist) => Math.min(...d.keys());
const distMax = (d: Dist) => Math.max(...d.keys());
const distMean = (d: Dist) => [...d].reduce((s, [x, p]) => s + x * p, 0);

/**
 * Per use: miss (0) with 1-acc, crit distribution with acc*crit, normal otherwise.
 * Returns P(cumulative damage >= hp) after n uses, n = 1..4.
 */
export function koProbabilities(hp: number, normal: Dist, crit: Dist, accuracy: number, critChance: number): [number, number, number, number] {
  const perUse: Dist = new Map();
  const add = (d: number, p: number) => {
    if (p > 0) perUse.set(Math.min(d, hp), (perUse.get(Math.min(d, hp)) ?? 0) + p);
  };
  add(0, 1 - accuracy);
  for (const [r, p] of normal) add(r, accuracy * (1 - critChance) * p);
  for (const [r, p] of crit) add(r, accuracy * critChance * p);

  const out: number[] = [];
  let dist: Dist = new Map([[0, 1]]);
  for (let n = 1; n <= 4; n++) {
    const next: Dist = new Map();
    for (const [d, p] of dist) {
      if (d >= hp) {
        next.set(hp, (next.get(hp) ?? 0) + p);
        continue;
      }
      for (const [x, q] of perUse) {
        const t = Math.min(hp, d + x);
        next.set(t, (next.get(t) ?? 0) + p * q);
      }
    }
    dist = next;
    out.push(snap(dist.get(hp) ?? 0));
  }
  return out as [number, number, number, number];
}

/** Remove float noise so a guaranteed KO reads exactly 1 (and an impossible one exactly 0). */
function snap(p: number): number {
  if (p > 1 - 1e-9) return 1;
  if (p < 1e-9) return 0;
  return p;
}

export interface DamageOptions {
  attacker?: CombatantOptions;
  defender?: CombatantOptions;
  field?: FieldInput;
  /** Override accuracy (e.g. No Guard, or to ignore misses). 0-1. */
  accuracy?: number;
  critStage?: number;
}

export function calcDamage(attacker: Build, defender: Build, moveName: string, reg: Regulation, opts: DamageOptions = {}): DamageResult {
  const atk = toCalcPokemon(attacker, reg, opts.attacker);
  const def = toCalcPokemon(defender, reg, opts.defender);
  const field = new Field({ gameType: 'Doubles', ...opts.field });
  const res = calculate(calcGen, atk, def, makeMove(moveName, reg), field);
  const crit = calculate(calcGen, atk, def, makeMove(moveName, reg, { isCrit: true }), field);
  const dexMove = dex.moves.get(moveName);
  const assumptions: string[] = ['No residual damage, recovery or stat changes between uses'];

  const normalDist = distOf(res.damage);
  const critDist = distOf(crit.damage);
  const rolls = Array.isArray(res.damage) && !Array.isArray(res.damage[0]) ? (res.damage as number[]) : [...normalDist.keys()].sort((a, b) => a - b);
  const critRolls = Array.isArray(crit.damage) && !Array.isArray(crit.damage[0]) ? (crit.damage as number[]) : [...critDist.keys()].sort((a, b) => a - b);
  const accuracy = opts.accuracy ?? (dexMove.accuracy === true ? 1 : dexMove.accuracy / 100);
  if (opts.accuracy === undefined && dexMove.accuracy !== true && dexMove.accuracy < 100) {
    assumptions.push(`Accuracy ${dexMove.accuracy}% (no accuracy/evasion modifiers applied)`);
  }
  const willCrit = !!dexMove.willCrit;
  const critChance = willCrit ? 1 : critChanceForStage((dexMove.critRatio ?? 1) - 1 + (opts.critStage ?? 0));
  const hp = def.originalCurHP;
  const maxHP = def.maxHP();
  const expected = accuracy * ((1 - critChance) * distMean(normalDist) + critChance * distMean(critDist));
  const effRolls = willCrit ? critRolls : rolls;
  const effDist = willCrit ? critDist : normalDist;

  return {
    attacker: atk.name,
    defender: def.name,
    move: res.move.name,
    defenderHP: hp,
    rolls: effRolls,
    critRolls,
    min: distMin(effDist),
    max: distMax(effDist),
    minPct: (100 * distMin(effDist)) / maxHP,
    maxPct: (100 * distMax(effDist)) / maxHP,
    expected,
    accuracy,
    critChance,
    koChance: koProbabilities(hp, normalDist, critDist, accuracy, critChance),
    description: safeDesc(res),
    assumptions,
  };
}

function safeDesc(res: ReturnType<typeof calculate>): string {
  try {
    return res.desc();
  } catch {
    return `${res.attacker.name} ${res.move.name} vs. ${res.defender.name}: ${res.range().join('-')}`;
  }
}

/** Final in-battle speed (stat + boosts + item + ability + Tailwind + paralysis), via @smogon/calc. */
export function finalSpeed(build: Build, reg: Regulation, opts: CombatantOptions & { tailwind?: boolean; field?: FieldInput } = {}): number {
  const p = toCalcPokemon(build, reg, opts);
  const field = new Field({ gameType: 'Doubles', ...opts.field, attackerSide: { isTailwind: !!opts.tailwind } });
  return getFinalSpeed(calcGen, p, field, field.attackerSide);
}
