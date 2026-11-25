import { calcDamage, finalSpeed, type FieldInput } from './damage.js';
import { dex } from './data/dex.js';
import { opponentModel, type OpponentModel, type Reveals } from './opponent.js';
import type { Build, StatTable } from './build.js';
import type { MetaSnapshot } from './meta.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';

/**
 * Battle situation analysis (training / post-game review — not for use during official competition).
 * Given the board state, compares your available actions: damage and KO odds on each target with
 * current HP, speed order with boosts/Tailwind/Trick Room/paralysis, and the rival's most dangerous
 * replies averaged over its plausible builds (updated by what has been revealed).
 */
export interface MySide {
  build: Build;
  hpPercent: number;
  boosts?: Partial<StatTable>;
  status?: '' | 'par' | 'brn' | 'psn' | 'tox' | 'slp' | 'frz';
}
export interface OppSide {
  species: string;
  hpPercent: number;
  boosts?: Partial<StatTable>;
  status?: MySide['status'];
  reveals?: Reveals;
}
export interface SituationInput {
  format: FormatId;
  mine: MySide[];
  theirs: OppSide[];
  field: { weather?: string; terrain?: string; trickRoom?: boolean; myTailwind?: boolean; theirTailwind?: boolean; myReflect?: boolean; myLightScreen?: boolean; theirReflect?: boolean; theirLightScreen?: boolean };
  opponentTeam?: string[];
}

export interface ActionRow {
  user: number;
  move: string;
  target: number;
  minPct: number;
  maxPct: number;
  koChance: number; // this turn, from current HP
  movesFirst: number; // P(user acts before target), over target's plausible builds
  priority: number;
  score: number;
  note: string;
}
export interface ThreatRow {
  from: number;
  to: number;
  move: string;
  maxPct: number;
  koChance: number;
  theyMoveFirst: number;
}
export interface SituationResult {
  actions: ActionRow[];
  threats: ThreatRow[];
  models: OpponentModel[];
  summary: string[];
  limitations: string[];
}

export async function analyseSituation(input: SituationInput, snapshot: MetaSnapshot | undefined, reg: Regulation): Promise<SituationResult> {
  const gameType = reg.format(input.format).gameType;
  const f = input.field;
  const mkField = (mineAttacking: boolean): FieldInput => ({
    gameType,
    weather: (f.weather || undefined) as never,
    terrain: (f.terrain || undefined) as never,
    attackerSide: { isTailwind: mineAttacking ? !!f.myTailwind : !!f.theirTailwind } as never,
    defenderSide: (mineAttacking ? { isReflect: !!f.theirReflect, isLightScreen: !!f.theirLightScreen } : { isReflect: !!f.myReflect, isLightScreen: !!f.myLightScreen }) as never,
  });
  const models = await Promise.all(input.theirs.map((o) => opponentModel(o.species, snapshot, { team: input.opponentTeam, reveals: o.reveals })));
  const speedOf = (b: Build, boosts: Partial<StatTable> | undefined, status: string | undefined, tailwind: boolean) => {
    let s = finalSpeed(b, reg, { boosts, tailwind });
    if (status === 'par') s = Math.floor(s / 2);
    return s;
  };
  const order = (a: number, b: number, pa: number, pb: number) => {
    if (pa !== pb) return pa > pb ? 1 : 0;
    const first = a > b ? 1 : a === b ? 0.5 : 0;
    return f.trickRoom ? 1 - first : first;
  };

  const actions: ActionRow[] = [];
  input.mine.forEach((me, u) => {
    const mySpe = speedOf(me.build, me.boosts, me.status, !!f.myTailwind);
    for (const mv of me.build.moves) {
      const move = dex.moves.get(mv);
      if (!move.exists || move.category === 'Status') {
        actions.push({ user: u, move: move.name || mv, target: -1, minPct: 0, maxPct: 0, koChance: 0, movesFirst: 0, priority: move.priority ?? 0, score: 0, note: 'Movimiento de estado: valóralo según el plan (no se calcula daño).' });
        continue;
      }
      models.forEach((m, t) => {
        let ko = 0;
        let minP = 0;
        let maxP = 0;
        let first = 0;
        for (const c of m.candidates) {
          try {
            const r = calcDamage(me.build, c.build, move.name, reg, { field: mkField(true), attacker: { boosts: me.boosts, status: me.status || undefined, curHPPercent: me.hpPercent }, defender: { boosts: input.theirs[t]!.boosts, curHPPercent: input.theirs[t]!.hpPercent } });
            ko += c.weight * r.koChance[0];
            minP += c.weight * r.minPct;
            maxP += c.weight * r.maxPct;
          } catch {
            /* unmodelled */
          }
          const ts = speedOf(c.build, input.theirs[t]!.boosts, input.theirs[t]!.status, !!f.theirTailwind);
          first += c.weight * order(mySpe, ts, move.priority, 0);
        }
        const remaining = input.theirs[t]!.hpPercent;
        const score = ko * (0.6 + 0.4 * first) + Math.min(1, maxP / Math.max(1, remaining)) * 0.25;
        actions.push({
          user: u,
          move: move.name,
          target: t,
          minPct: minP,
          maxPct: maxP,
          koChance: ko,
          movesFirst: first,
          priority: move.priority,
          score,
          note: ko > 0.95 ? (first > 0.5 ? 'KO casi seguro y actúas antes.' : 'KO casi seguro, pero el rival actúa antes.') : ko > 0 ? `KO posible (${(ko * 100).toFixed(0)}%).` : `Daño ${minP.toFixed(0)}–${maxP.toFixed(0)}% (le queda ${remaining}%).`,
        });
      });
    }
  });
  actions.sort((a, b) => b.score - a.score);

  const threats: ThreatRow[] = [];
  models.forEach((m, from) => {
    input.mine.forEach((me, to) => {
      const mySpe = speedOf(me.build, me.boosts, me.status, !!f.myTailwind);
      const byMove = new Map<string, { max: number; ko: number; first: number }>();
      for (const c of m.candidates) {
        for (const lm of c.likelyMoves) {
          const mv = dex.moves.get(lm.move);
          if (!mv.exists || mv.category === 'Status') continue;
          try {
            const r = calcDamage(c.build, me.build, mv.name, reg, { field: mkField(false), attacker: { boosts: input.theirs[from]!.boosts }, defender: { boosts: me.boosts, curHPPercent: me.hpPercent } });
            const ts = speedOf(c.build, input.theirs[from]!.boosts, input.theirs[from]!.status, !!f.theirTailwind);
            const acc = byMove.get(mv.name) ?? { max: 0, ko: 0, first: 0 };
            acc.max += c.weight * lm.p * r.maxPct;
            acc.ko += c.weight * lm.p * r.koChance[0];
            acc.first += c.weight * lm.p * (1 - order(mySpe, ts, 0, mv.priority));
            byMove.set(mv.name, acc);
          } catch {
            /* unmodelled */
          }
        }
      }
      const best = [...byMove.entries()].sort((a, b) => b[1].ko - a[1].ko || b[1].max - a[1].max)[0];
      if (best) threats.push({ from, to, move: best[0], maxPct: best[1].max, koChance: best[1].ko, theyMoveFirst: best[1].first });
    });
  });
  threats.sort((a, b) => b.koChance - a.koChance || b.maxPct - a.maxPct);

  const summary: string[] = [];
  const top = actions.find((a) => a.target >= 0);
  if (top) summary.push(`Mejor acción ofensiva: ${input.mine[top.user]!.build.species} usa ${top.move} sobre ${models[top.target]!.species} — ${top.note}`);
  const danger = threats[0];
  if (danger && danger.koChance > 0.3)
    summary.push(`Mayor riesgo: ${models[danger.from]!.species} puede debilitar a ${input.mine[danger.to]!.build.species} con ${danger.move} (≈${(danger.koChance * 100).toFixed(0)}% ponderado por probabilidad del movimiento)${danger.theyMoveFirst > 0.5 ? ' y actúa antes' : ''}. Considera Protect o cambiar.`);
  if (models.some((m) => m.updatedByReveals)) summary.push('Las builds rivales se han actualizado con la información revelada.');
  return {
    actions,
    threats,
    models,
    summary,
    limitations: [
      'Herramienta de práctica y análisis posterior: no la uses durante competiciones oficiales (prohíben la asistencia externa).',
      'Riesgo ponderado por la probabilidad de que el rival lleve cada movimiento; no predice qué elegirá.',
      'No modela Protect, cambios del rival, objetivos redirigidos ni efectos secundarios.',
    ],
  };
}
