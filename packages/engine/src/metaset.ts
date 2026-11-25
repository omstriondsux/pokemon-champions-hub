import { database, getSpecies, registeredForme } from './data/dex.js';
import { opponentModel, type OpponentModel } from './opponent.js';
import { evaluatePair, type AdvisorOptions } from './advisor.js';
import type { Build } from './build.js';
import type { MetaSnapshot } from './meta.js';
import type { Regulation } from './rules/regulation.js';

/**
 * A weighted sample of the metagame used as the "opponent" by the optimizers:
 * the top-N species at team preview (megas folded into their base), each with its usage weight
 * and its most likely candidate sets (trimmed for speed).
 */
export interface MetaSet {
  models: OpponentModel[];
  weights: number[]; // usage share, normalised to sum 1
  usage: number[]; // raw usage
}

export function trimModel(m: OpponentModel, k: number): OpponentModel {
  if (m.candidates.length <= k) return m;
  const kept = m.candidates.slice(0, k);
  const sum = kept.reduce((s, c) => s + c.weight, 0);
  return { ...m, candidates: kept.map((c) => ({ ...c, weight: c.weight / sum })) };
}

export async function buildMetaSet(snapshot: MetaSnapshot | undefined, topN: number, candidatesPer = 3): Promise<MetaSet> {
  if (!snapshot) return { models: [], weights: [], usage: [] };
  const species: string[] = [];
  for (const [name] of Object.entries(snapshot.pokemon).sort((a, b) => b[1].usage - a[1].usage)) {
    const base = getSpecies(name)?.isMega ? registeredForme(name) : name;
    if (!database.hasSpecies(base) || species.includes(base)) continue;
    species.push(base);
    if (species.length >= topN) break;
  }
  const models: OpponentModel[] = [];
  for (const s of species) {
    try {
      models.push(trimModel(await opponentModel(s, snapshot), candidatesPer));
    } catch {
      /* species the calc cannot model are skipped */
    }
  }
  const usage = models.map((m) => m.usage);
  const total = usage.reduce((a, b) => a + b, 0) || 1;
  return { models, weights: usage.map((u) => u / total), usage };
}

export interface MetaScore {
  score: number; // usage-weighted mean 1v1 index
  worst: number; // usage-weighted mean worst case
  rows: { species: string; weight: number; score: number; worst: number }[];
}

/** How a single build fares against the metagame sample (same index as the Battle Advisor). */
export function scoreVsMeta(build: Build, meta: MetaSet, reg: Regulation, opts: AdvisorOptions): MetaScore {
  let score = 0;
  let worst = 0;
  const rows: MetaScore['rows'] = [];
  meta.models.forEach((m, i) => {
    const p = evaluatePair(build, m, reg, opts);
    const w = meta.weights[i]!;
    score += w * p.score;
    worst += w * p.worst;
    rows.push({ species: m.species, weight: w, score: p.score, worst: p.worst });
  });
  return { score, worst, rows };
}

const ARCH_SOURCES: { archetype: string; kind: 'move' | 'ability'; ids: string[] }[] = [
  { archetype: 'Trick Room', kind: 'move', ids: ['trickroom'] },
  { archetype: 'Tailwind', kind: 'move', ids: ['tailwind'] },
  { archetype: 'Lluvia', kind: 'ability', ids: ['drizzle'] },
  { archetype: 'Sol', kind: 'ability', ids: ['drought'] },
  { archetype: 'Arena', kind: 'ability', ids: ['sandstream'] },
  { archetype: 'Nieve', kind: 'ability', ids: ['snowwarning'] },
  { archetype: 'Campo psíquico', kind: 'ability', ids: ['psychicsurge'] },
  { archetype: 'Campo de hierba', kind: 'ability', ids: ['grassysurge'] },
  { archetype: 'Campo eléctrico', kind: 'ability', ids: ['electricsurge'] },
  { archetype: 'Redirección', kind: 'move', ids: ['followme', 'ragepowder'] },
  { archetype: 'Fake Out', kind: 'move', ids: ['fakeout'] },
  { archetype: 'Intimidate', kind: 'ability', ids: ['intimidate'] },
];

/**
 * Presence of each archetype/support piece: expected number of setters per team
 * = Σ usage(species) × P(species carries it). Usage counts team share, so this is an upper bound
 * on the fraction of teams that have at least one setter (teams can carry two).
 */
export function archetypePresence(snapshot: MetaSnapshot) {
  return ARCH_SOURCES.map((a) => {
    const setters: { species: string; share: number }[] = [];
    let expected = 0;
    for (const [name, mon] of Object.entries(snapshot.pokemon)) {
      const rec = a.kind === 'move' ? mon.moves : mon.abilities;
      const p = a.ids.reduce((s, id) => s + (rec[id] ?? 0), 0);
      if (p <= 0) continue;
      expected += mon.usage * Math.min(1, p);
      if (mon.usage * p >= 0.005) setters.push({ species: name, share: mon.usage * Math.min(1, p) });
    }
    return { archetype: a.archetype, expectedPerTeam: expected, setters: setters.sort((x, y) => y.share - x.share).slice(0, 6) };
  }).sort((a, b) => b.expectedPerTeam - a.expectedPerTeam);
}
