import { database, dex, getSpecies, learnableMoves, registeredForme } from './data/dex.js';
import { makeBuild, type Build } from './build.js';
import { parseSpread, topEntries, type MetaSnapshot } from './meta.js';

/**
 * Plausible configurations of an opponent's Pokémon, seen at team preview.
 *
 * F1 model (explicit, explainable): candidate sets from the usage snapshot, weighted by
 *   P(forme) × P(spread) × P(item), including Mega formes (not visible at preview).
 * F2 will condition these on teammates/archetype and on revealed information (Bayesian update).
 */
export interface OpponentCandidate {
  build: Build;
  /** Probability among this species' candidates (sums to 1). */
  weight: number;
  /** Moves this set may carry, with P(in moveset). Used for threat calcs (they pick their best move). */
  likelyMoves: { move: string; p: number }[];
  label: string; // "Charizard-Mega-Y · Timid 2/0/0/32/0/32 · Charizardite Y"
  forme: string; // species shown in battle (mega forme if any)
}

export interface OpponentModel {
  species: string;
  source: 'meta' | 'fallback';
  /** 'high' | 'medium' | 'low' from snapshot sample size, or 'hypothesis' when there is no data. */
  reliability: 'high' | 'medium' | 'low' | 'hypothesis';
  usage: number; // 0 when absent from the snapshot
  rawCount: number;
  candidates: OpponentCandidate[];
  tags: string[]; // "Trick Room", "Tailwind", "Fake Out", "Intimidate", "Lluvia"...
  notes: string[];
}

const MAX_SPREADS = 3;
const MAX_ITEMS = 2;
const MAX_MOVES = 8;
const MIN_MOVE_P = 0.08;
const MIN_CANDIDATE_W = 0.03;

const TAG_MOVES: Record<string, string> = {
  trickroom: 'Trick Room',
  tailwind: 'Tailwind',
  fakeout: 'Fake Out',
  followme: 'Redirección',
  ragepowder: 'Redirección',
  icywind: 'Control de velocidad',
  electroweb: 'Control de velocidad',
  spore: 'Sueño',
  reflect: 'Pantallas',
  lightscreen: 'Pantallas',
  auroraveil: 'Pantallas',
  protect: 'Protect',
  partingshot: 'Pivote',
  uturn: 'Pivote',
};
const TAG_ABILITIES: Record<string, string> = {
  intimidate: 'Intimidate',
  drizzle: 'Lluvia',
  drought: 'Sol',
  sandstream: 'Arena',
  snowwarning: 'Nieve',
  electricsurge: 'Campo eléctrico',
  psychicsurge: 'Campo psíquico',
  grassysurge: 'Campo de hierba',
  mistysurge: 'Campo de niebla',
  prankster: 'Prankster',
};

/** Formes that are the same Pokémon at team preview (base + its megas). */
function previewFormes(species: string, snapshot: MetaSnapshot): string[] {
  const base = getSpecies(species);
  if (!base) return [];
  return Object.keys(snapshot.pokemon).filter((name) => {
    if (name === base.name) return true;
    const s = getSpecies(name);
    return !!s && !!s.isMega && registeredForme(name) === base.name;
  });
}

export async function opponentModel(species: string, snapshot: MetaSnapshot | undefined): Promise<OpponentModel> {
  const base = getSpecies(registeredForme(species));
  if (!base) throw new Error(`Unknown species: ${species}`);
  const formes = snapshot ? previewFormes(base.name, snapshot) : [];
  if (!snapshot || formes.length === 0) return fallbackModel(base.name, !!snapshot);

  const totalUsage = formes.reduce((s, f) => s + snapshot.pokemon[f]!.usage, 0);
  const candidates: OpponentCandidate[] = [];
  const tags = new Set<string>();
  let rawCount = 0;

  for (const f of formes) {
    const mon = snapshot.pokemon[f]!;
    rawCount += mon.rawCount;
    const pForme = mon.usage / totalUsage;
    const formeSpecies = getSpecies(f)!;
    const isMega = !!formeSpecies.isMega;

    const spreads = topEntries(mon.spreads, MAX_SPREADS).map(([k, p]) => ({ s: parseSpread(k), p })).filter((x) => x.s);
    const spreadSum = spreads.reduce((a, b) => a + b.p, 0) || 1;
    const items = isMega ? topEntries(mon.items, 1) : topEntries(mon.items, MAX_ITEMS);
    const itemSum = items.reduce((a, b) => a + b[1], 0) || 1;
    const abilityId = topEntries(mon.abilities, 1)[0]?.[0];
    const ability = abilityId ? dex.abilities.get(abilityId).name : base.abilities[0];
    const likelyMoves = topEntries(mon.moves, MAX_MOVES)
      .filter(([, p]) => p >= MIN_MOVE_P)
      .map(([id, p]) => ({ move: dex.moves.get(id).name, p }))
      .filter((m) => database.hasMove(m.move));

    for (const [id, p] of Object.entries(mon.moves)) if (p >= 0.25 && TAG_MOVES[id]) tags.add(TAG_MOVES[id]!);
    if (abilityId && TAG_ABILITIES[abilityId]) tags.add(TAG_ABILITIES[abilityId]!);
    if (isMega) tags.add(`Mega posible: ${f}`);

    for (const { s, p: pS } of spreads) {
      for (const [itemId, pI] of items.length ? items : [['', 1] as [string, number]]) {
        const item = itemId ? dex.items.get(itemId).name : undefined;
        const weight = pForme * (pS / spreadSum) * (pI / itemSum);
        candidates.push({
          build: makeBuild({
            species: base.name,
            ability: isMega ? base.abilities[0] : ability,
            item,
            alignment: s!.alignment,
            moves: likelyMoves.slice(0, 4).map((m) => m.move),
            sp: s!.sp,
          }),
          weight,
          likelyMoves,
          forme: f,
          label: `${f} · ${s!.alignment} ${Object.values(s!.sp).join('/')}${item ? ` · ${item}` : ''}`,
        });
      }
    }
  }

  const kept = candidates.filter((c) => c.weight >= MIN_CANDIDATE_W);
  const sum = kept.reduce((a, c) => a + c.weight, 0);
  for (const c of kept) c.weight /= sum;
  kept.sort((a, b) => b.weight - a.weight);

  const rel = rawCount >= 10_000 ? 'high' : rawCount >= 1_000 ? 'medium' : 'low';
  return {
    species: base.name,
    source: 'meta',
    reliability: rel,
    usage: totalUsage,
    rawCount,
    candidates: kept,
    tags: [...tags],
    notes: [
      `Top ${MAX_SPREADS} spreads × top ${MAX_ITEMS} items per forme, candidates under ${MIN_CANDIDATE_W * 100}% dropped.`,
      ...(rel === 'low' ? ['Muestra pequeña: estas builds son poco fiables.'] : []),
    ],
  };
}

/** No usage data: build an explicit hypothesis from base stats and learnset, and say so. */
async function fallbackModel(species: string, hadSnapshot: boolean): Promise<OpponentModel> {
  const s = getSpecies(species)!;
  const physical = s.baseStats.atk >= s.baseStats.spa;
  const learnable = [...(await learnableMoves(species))].map((id) => dex.moves.get(id)).filter((m) => m.exists && m.category !== 'Status' && database.hasMove(m.name));
  const cat = physical ? 'Physical' : 'Special';
  const score = (m: (typeof learnable)[number]) => (m.basePower || 0) * (m.accuracy === true ? 1 : m.accuracy / 100) * (s.types.includes(m.type) ? 1.5 : 1) * (m.category === cat ? 1 : 0.6) * (m.flags.charge || m.flags.recharge ? 0.5 : 1);
  const best = learnable.sort((a, b) => score(b) - score(a));
  const picked: string[] = [];
  for (const t of s.types) {
    const m = best.find((x) => x.type === t);
    if (m) picked.push(m.name);
  }
  for (const m of best) if (picked.length < 4 && !picked.includes(m.name)) picked.push(m.name);
  const build = makeBuild({
    species,
    ability: s.abilities[0],
    alignment: physical ? 'Adamant' : 'Modest',
    moves: picked,
    sp: { hp: 2, [physical ? 'atk' : 'spa']: 32, spe: 32 },
  });
  return {
    species,
    source: 'fallback',
    reliability: 'hypothesis',
    usage: 0,
    rawCount: 0,
    candidates: [{ build, weight: 1, likelyMoves: picked.map((move) => ({ move, p: 1 })), forme: species, label: `${species} · hipótesis ofensiva (sin datos)` }],
    tags: [],
    notes: [hadSnapshot ? 'No aparece en las estadísticas de uso: build hipotética (máxima ofensiva y velocidad).' : 'Sin snapshot de meta cargado: build hipotética.'],
  };
}
