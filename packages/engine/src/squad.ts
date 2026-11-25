import { dex, getSpecies, toID } from './data/dex.js';
import { evaluatePair, type AdvisorOptions } from './advisor.js';
import { megaFormeOf } from './legality.js';
import type { MetaSet } from './metaset.js';
import type { Build } from './build.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';

/**
 * Squad Builder — constrained beam search over the user's inventory.
 *
 * Team score (all terms explained in the output):
 *   coverage    usage-weighted best answer to each meta Pokémon (max over members of the 1v1 index)
 *   consistency same with the worst plausible rival build (robustness to unexpected sets)
 *   depth       how many members answer each meta threat (one answer can be lost early)
 *   offense     mean offensive pressure (1v1 index, positive part)
 *   speed       presence of speed control (Tailwind, Trick Room, Icy Wind, Electroweb, Thunder Wave)
 *   support     Fake Out, Intimidate, redirection
 *   weakness    penalty for 3+ members weak to the same attacking type
 *   favorites / cost   user preferences
 * Weights depend on the objective profile. Constraints: Species Clause, Item Clause, one build per owned
 * Pokémon, locked members always included. A popular Pokémon only gets in if it raises the score.
 */

export type SquadProfile = 'balanced' | 'consistency' | 'coverage' | 'aggressive' | 'speed' | 'antimeta' | 'favorites' | 'lowcost';

export const PROFILE_LABEL: Record<SquadProfile, string> = {
  balanced: 'Equilibrado',
  consistency: 'Máxima consistencia',
  coverage: 'Máxima cobertura',
  aggressive: 'Agresivo',
  speed: 'Control de velocidad',
  antimeta: 'Anti-meta (top del uso)',
  favorites: 'Tus favoritos',
  lowcost: 'Menor coste de entrenamiento/reclutamiento',
};

type Term = 'coverage' | 'consistency' | 'depth' | 'offense' | 'speed' | 'support' | 'weakness' | 'favorites' | 'cost';
const WEIGHTS: Record<SquadProfile, Partial<Record<Term, number>>> = {
  balanced: { coverage: 0.35, consistency: 0.2, depth: 0.15, offense: 0.1, speed: 0.08, support: 0.07, weakness: 0.05 },
  consistency: { coverage: 0.2, consistency: 0.4, depth: 0.2, speed: 0.07, support: 0.08, weakness: 0.05 },
  coverage: { coverage: 0.45, depth: 0.3, consistency: 0.1, weakness: 0.15 },
  aggressive: { offense: 0.4, coverage: 0.3, speed: 0.1, consistency: 0.1, weakness: 0.1 },
  speed: { speed: 0.3, coverage: 0.3, consistency: 0.15, support: 0.1, depth: 0.1, weakness: 0.05 },
  antimeta: { coverage: 0.4, consistency: 0.3, depth: 0.2, weakness: 0.1 },
  favorites: { favorites: 0.3, coverage: 0.3, consistency: 0.15, depth: 0.1, speed: 0.05, support: 0.05, weakness: 0.05 },
  lowcost: { cost: 0.3, coverage: 0.3, consistency: 0.15, depth: 0.1, speed: 0.05, support: 0.05, weakness: 0.05 },
};

export interface PoolEntry {
  id: string; // owned build id
  ownerId: string; // owned Pokémon id (one build per owner)
  label: string;
  build: Build;
  favorite?: boolean;
  /** 0 = ready, higher = more expensive to get ready (pending recruit/training, VP cost). */
  cost?: number;
}

export interface SquadTeam {
  members: number[]; // pool indexes
  score: number;
  terms: Record<Term, number>;
  contributions: { member: number; delta: number }[]; // score lost if removed
  uncovered: { species: string; usage: number; best: number }[];
  weaknesses: string[];
}

export interface SquadResult {
  profile: SquadProfile;
  teams: SquadTeam[];
  evidence: string[];
  limitations: string[];
  pairs: number;
  elapsedMs: number;
}

const SC = new Set(['tailwind', 'trickroom', 'icywind', 'electroweb', 'thunderwave']);
const SUP_MOVES = new Set(['fakeout', 'followme', 'ragepowder']);

export function buildSquads(
  pool: PoolEntry[],
  meta: MetaSet,
  reg: Regulation,
  format: FormatId,
  profile: SquadProfile,
  opts: { locked?: string[]; size?: number; beam?: number; results?: number; onProgress?: (p: number) => void } = {},
): SquadResult {
  const t0 = performance.now();
  const aopts: AdvisorOptions = { format };
  const size = Math.min(opts.size ?? reg.format(format).teamSize.value.max, pool.length);
  const beamW = opts.beam ?? 30;
  const weights = WEIGHTS[profile];
  const metaW = profile === 'antimeta' ? normalise(meta.weights.map((w) => w * w)) : meta.weights;

  // Matrices: P = mean index, Wc = worst case, Off = positive part
  const P: number[][] = [];
  const Wc: number[][] = [];
  pool.forEach((e, i) => {
    P.push([]);
    Wc.push([]);
    meta.models.forEach((m) => {
      const r = evaluatePair(e.build, m, reg, aopts);
      P[i]!.push(r.score);
      Wc[i]!.push(r.worst);
    });
    opts.onProgress?.((i + 1) / pool.length);
  });

  const feat = pool.map((e) => {
    const ids = e.build.moves.map((m) => toID(m) as string);
    const forme = megaFormeOf(e.build) ?? e.build.species;
    return {
      num: getSpecies(e.build.species)?.num ?? -1,
      item: e.build.item ? toID(e.build.item) : '',
      speed: ids.some((m) => SC.has(m)),
      support: ids.some((m) => SUP_MOVES.has(m)) || toID(e.build.ability) === 'intimidate',
      types: getSpecies(forme)?.types ?? [],
    };
  });
  const allTypes = dex.types.all().map((t) => t.name).filter((t) => t !== 'Stellar' && t !== '???');

  const evaluate = (members: number[]): { score: number; terms: Record<Term, number>; weaknesses: string[] } => {
    const terms: Record<Term, number> = { coverage: 0, consistency: 0, depth: 0, offense: 0, speed: 0, support: 0, weakness: 0, favorites: 0, cost: 0 };
    meta.models.forEach((_, o) => {
      let best = -1;
      let bestW = -1;
      let answers = 0;
      for (const i of members) {
        best = Math.max(best, P[i]![o]!);
        bestW = Math.max(bestW, Wc[i]![o]!);
        if (P[i]![o]! >= 0.25) answers++;
      }
      terms.coverage += metaW[o]! * best;
      terms.consistency += metaW[o]! * bestW;
      terms.depth += metaW[o]! * (Math.min(answers, 2) / 2);
    });
    terms.offense = mean(members.map((i) => mean(P[i]!.map((x) => Math.max(0, x)))));
    terms.speed = members.some((i) => feat[i]!.speed) ? 1 : 0;
    terms.support = Math.min(1, members.filter((i) => feat[i]!.support).length / 2);
    const weaknesses: string[] = [];
    for (const t of allTypes) {
      let weak = 0;
      // getImmunity = "can be hit"; getEffectiveness > 0 = super effective
      for (const i of members) if (dex.getImmunity(t, feat[i]!.types) && dex.getEffectiveness(t, feat[i]!.types) > 0) weak++;
      if (weak >= 3) weaknesses.push(`${t} (${weak})`);
    }
    terms.weakness = -weaknesses.length / 3;
    terms.favorites = mean(members.map((i) => (pool[i]!.favorite ? 1 : 0)));
    terms.cost = -mean(members.map((i) => Math.min(1, (pool[i]!.cost ?? 0) / 2)));
    let score = 0;
    for (const [k, w] of Object.entries(weights)) score += w! * terms[k as Term];
    return { score, terms, weaknesses };
  };

  const legalAdd = (members: number[], j: number) => {
    if (members.includes(j)) return false;
    const e = pool[j]!;
    for (const i of members) {
      if (pool[i]!.ownerId === e.ownerId) return false;
      if (feat[i]!.num === feat[j]!.num) return false;
      if (feat[j]!.item && feat[i]!.item === feat[j]!.item) return false;
    }
    return true;
  };

  const lockedIdx = (opts.locked ?? []).map((id) => pool.findIndex((p) => p.id === id)).filter((i) => i >= 0);
  let beam: number[][] = [lockedIdx];
  while ((beam[0]?.length ?? size) < size) {
    const next = new Map<string, { m: number[]; s: number }>();
    for (const members of beam) {
      for (let j = 0; j < pool.length; j++) {
        if (!legalAdd(members, j)) continue;
        const m = [...members, j].sort((a, b) => a - b);
        const key = m.join(',');
        if (!next.has(key)) next.set(key, { m, s: evaluate(m).score });
      }
    }
    if (!next.size) break; // not enough legal members left
    beam = [...next.values()].sort((a, b) => b.s - a.s).slice(0, beamW).map((x) => x.m);
  }

  const teams: SquadTeam[] = beam.slice(0, opts.results ?? 3).map((members) => {
    const { score, terms, weaknesses } = evaluate(members);
    const contributions = members.map((i) => ({ member: i, delta: score - evaluate(members.filter((x) => x !== i)).score })).sort((a, b) => b.delta - a.delta);
    const uncovered = meta.models
      .map((m, o) => ({ species: m.species, usage: meta.usage[o]!, best: Math.max(...members.map((i) => P[i]![o]!)) }))
      .filter((u) => u.best < 0.25)
      .sort((a, b) => b.usage - a.usage);
    return { members, score, terms, contributions, uncovered, weaknesses };
  });

  return {
    profile,
    teams,
    evidence: [
      `Muestra del meta: top ${meta.models.length} especies ponderadas por uso${profile === 'antimeta' ? ' (al cuadrado: prioriza el top)' : ''}.`,
      `Búsqueda en haz (ancho ${beamW}) sobre ${pool.length} builds de tu inventario con Species Clause, Item Clause y una build por Pokémon.`,
      `Pesos del perfil «${PROFILE_LABEL[profile]}»: ${Object.entries(weights).map(([k, w]) => `${k} ${w}`).join(', ')}.`,
    ],
    limitations: ['Puntuación heurística para comparar equipos entre sí, no probabilidad de victoria.', 'La búsqueda en haz no garantiza el óptimo global, pero explora las mejores ampliaciones en cada paso.'],
    pairs: pool.length * meta.models.length,
    elapsedMs: performance.now() - t0,
  };
}

const mean = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const normalise = (a: number[]) => {
  const s = a.reduce((x, y) => x + y, 0) || 1;
  return a.map((x) => x / s);
};
