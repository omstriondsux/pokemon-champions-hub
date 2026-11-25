import { dex } from './data/dex.js';
import { calcDamage, finalSpeed, type CombatantOptions, type DamageOptions } from './damage.js';
import { totalSp, type Build } from './build.js';
import type { Regulation } from './rules/regulation.js';
import type { StatID } from '@smogon/calc';

/**
 * Threshold questions from the spec, answered by exhaustive search over Stat Points.
 * The space per question is ≤ 33×33 combinations, so brute force is exact and fast.
 */

/** Thresholds follow the usual convention: over all 16 rolls, the move hits, no crit (override via opts). */
const thresholdOpts = (opts: DamageOptions): DamageOptions => ({ accuracy: 1, ignoreCrit: true, ...opts });

const limits = (reg: Regulation) => ({ total: reg.pack.statPoints.total.value, cap: reg.pack.statPoints.perStatMax.value });

/** SP left for `stats` if every other stat keeps its current investment. */
function budgetFor(build: Build, reg: Regulation, stats: StatID[]): number {
  const others = totalSp(build.sp) - stats.reduce((s, k) => s + build.sp[k], 0);
  return limits(reg).total - others;
}

export interface SpeedTarget {
  sp: number;
  speed: number;
  /** true = only ties the target (50% to move first), not strictly faster. */
  tieOnly: boolean;
}

/** ¿Cuántos SP necesito en Velocidad para superar `targetSpeed`? null = imposible con esta alineación. */
export function minSpeedSp(build: Build, reg: Regulation, targetSpeed: number, opts: CombatantOptions & { tailwind?: boolean } = {}): SpeedTarget | null {
  const { cap } = limits(reg);
  const max = Math.min(cap, budgetFor(build, reg, ['spe']));
  let tie: SpeedTarget | null = null;
  for (let sp = 0; sp <= max; sp++) {
    const speed = finalSpeed({ ...build, sp: { ...build.sp, spe: sp } }, reg, opts);
    if (speed > targetSpeed) return { sp, speed, tieOnly: false };
    if (speed === targetSpeed && !tie) tie = { sp, speed, tieOnly: true };
  }
  return tie;
}

/** ¿Estoy desperdiciando Velocidad? SP that can be removed while still beating `targetSpeed`. */
export function wastedSpeedSp(build: Build, reg: Regulation, targetSpeed: number, opts: CombatantOptions & { tailwind?: boolean } = {}): number {
  const need = minSpeedSp({ ...build, sp: { ...build.sp, spe: 0 } }, reg, targetSpeed, opts);
  if (!need || need.tieOnly) return 0;
  return Math.max(0, build.sp.spe - need.sp);
}

export interface BulkResult {
  hp: number;
  def: number; // SP in the relevant defensive stat
  defStat: 'def' | 'spd';
  totalUsed: number;
  survivalChance: number;
}

/**
 * ¿Cuántos puntos defensivos necesito para sobrevivir a `move`?
 * Minimises HP+Def (or HP+SpD) SP so that P(survive one hit) ≥ threshold. Other stats unchanged.
 */
export function minBulkToSurvive(
  attacker: Build,
  defender: Build,
  move: string,
  reg: Regulation,
  opts: DamageOptions & { threshold?: number } = {},
): BulkResult | null {
  const threshold = opts.threshold ?? 1;
  const m = dex.moves.get(move);
  const defStat: 'def' | 'spd' = m.category === 'Special' && !m.overrideDefensiveStat ? 'spd' : 'def';
  const { cap } = limits(reg);
  const budget = budgetFor(defender, reg, ['hp', defStat]);
  let best: BulkResult | null = null;
  for (let total = 0; total <= Math.min(budget, 2 * cap); total++) {
    for (let hp = Math.max(0, total - cap); hp <= Math.min(cap, total); hp++) {
      const d = total - hp;
      const trial: Build = { ...defender, sp: { ...defender.sp, hp, [defStat]: d } };
      const r = calcDamage(attacker, trial, move, reg, thresholdOpts(opts));
      const survive = 1 - r.koChance[0];
      if (survive >= threshold - 1e-12 && (!best || survive > best.survivalChance)) {
        best = { hp, def: d, defStat, totalUsed: total, survivalChance: survive };
      }
    }
    if (best) return best; // smallest total that works; within it, the safest split
  }
  return null;
}

export interface OffenseResult {
  sp: number;
  stat: 'atk' | 'spa';
  koChance: number;
}

/** ¿Cuántos puntos ofensivos necesito para garantizar (o alcanzar `threshold`) el KO en `hits` usos? */
export function minOffenseToKO(
  attacker: Build,
  defender: Build,
  move: string,
  reg: Regulation,
  opts: DamageOptions & { threshold?: number; hits?: 1 | 2 | 3 | 4 } = {},
): OffenseResult | null {
  const threshold = opts.threshold ?? 1;
  const hits = opts.hits ?? 1;
  const m = dex.moves.get(move);
  const stat: 'atk' | 'spa' = m.category === 'Special' ? 'spa' : 'atk';
  const max = Math.min(limits(reg).cap, budgetFor(attacker, reg, [stat]));
  for (let sp = 0; sp <= max; sp++) {
    const trial: Build = { ...attacker, sp: { ...attacker.sp, [stat]: sp } };
    const r = calcDamage(trial, defender, move, reg, thresholdOpts(opts));
    const p = r.koChance[hits - 1]!;
    if (p >= threshold - 1e-12) return { sp, stat, koChance: p };
  }
  return null;
}
