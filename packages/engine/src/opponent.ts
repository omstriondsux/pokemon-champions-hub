import { database, dex, getSpecies, learnableMoves, registeredForme, toID } from './data/dex.js';
import { makeBuild, type Build } from './build.js';
import { parseSpread, topEntries, type MetaSnapshot } from './meta.js';

/**
 * Plausible configurations of an opponent's Pokémon, seen at team preview.
 *
 * Prior (usage snapshot): P(forme) × P(spread) × P(item), including Mega formes hidden at preview,
 * plus rare-but-dangerous variants (Choice Scarf, Focus Sash) when they reach 5%.
 * Team context: the opposing team's archetype (Trick Room, Tailwind, weather) re-weights spreads,
 * e.g. min-speed spreads become more likely on a Trick Room team even if globally rarer.
 * Evidence: revealed item / moves / ability act as a likelihood filter (Bayesian update):
 * candidates inconsistent with what was seen get weight 0; if none survive, a set matching
 * the evidence is synthesised and labelled as such.
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
  /** Team archetypes this model was conditioned on. */
  archetypes: Archetype[];
  /** true when revealed information changed the candidate set. */
  updatedByReveals: boolean;
}

export type Archetype = 'trickroom' | 'tailwind' | 'rain' | 'sun' | 'sand' | 'snow' | 'psychicterrain' | 'electricterrain' | 'grassyterrain';
export const ARCHETYPE_LABEL: Record<Archetype, string> = {
  trickroom: 'Trick Room',
  tailwind: 'Tailwind',
  rain: 'Lluvia',
  sun: 'Sol',
  sand: 'Arena',
  snow: 'Nieve',
  psychicterrain: 'Campo psíquico',
  electricterrain: 'Campo eléctrico',
  grassyterrain: 'Campo de hierba',
};

export interface Reveals {
  item?: string;
  ability?: string;
  moves?: string[];
}

export interface OpponentContext {
  /** The whole opposing team (species names), used to detect the archetype. */
  team?: string[];
  reveals?: Reveals;
  /** What you saw this species use in past battles (Battle History). */
  history?: Reveals[];
}

const MAX_SPREADS = 3;
const MAX_ITEMS = 2;
const MAX_CANDIDATES = 8;
const DANGEROUS_ITEMS = ['choicescarf', 'focussash'];
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

const ARCH_MOVES: Partial<Record<string, Archetype>> = { trickroom: 'trickroom', tailwind: 'tailwind' };
const ARCH_ABILITIES: Partial<Record<string, Archetype>> = {
  drizzle: 'rain',
  drought: 'sun',
  sandstream: 'sand',
  snowwarning: 'snow',
  psychicsurge: 'psychicterrain',
  electricsurge: 'electricterrain',
  grassysurge: 'grassyterrain',
};

/** Archetypes of an opposing team: a member sets it up in ≥ 30% of its sets (moves) or ≥ 50% (abilities). */
export function detectArchetypes(team: string[], snapshot: MetaSnapshot | undefined): Archetype[] {
  if (!snapshot) return [];
  const out = new Set<Archetype>();
  for (const sp of team) {
    for (const f of previewFormes(registeredForme(sp), snapshot)) {
      const mon = snapshot.pokemon[f]!;
      for (const [id, a] of Object.entries(ARCH_MOVES)) if ((mon.moves[id] ?? 0) >= 0.3) out.add(a!);
      for (const [id, a] of Object.entries(ARCH_ABILITIES)) if ((mon.abilities[id] ?? 0) >= 0.5) out.add(a!);
    }
  }
  return [...out];
}

/** Likelihood multiplier of a spread given the team archetype. */
function archetypeFactor(alignment: string, spe: number, arch: Archetype[]): number {
  const nat = dex.natures.get(alignment);
  const minSpeed = spe === 0 && nat.minus === 'spe';
  const maxSpeed = spe >= 28 && nat.plus === 'spe';
  let f = 1;
  if (arch.includes('trickroom')) f *= minSpeed ? 3 : maxSpeed ? 0.5 : 1;
  if (arch.includes('tailwind') && !arch.includes('trickroom')) f *= maxSpeed ? 1.3 : 1;
  return f;
}

function consistent(c: OpponentCandidate, r: Reveals): boolean {
  if (r.item && toID(c.build.item ?? '') !== toID(r.item)) return false;
  if (r.ability && toID(c.build.ability) !== toID(r.ability) && !c.forme.includes('Mega')) return false;
  return true;
}

export async function opponentModel(species: string, snapshot: MetaSnapshot | undefined, ctx: OpponentContext = {}): Promise<OpponentModel> {
  const base = getSpecies(registeredForme(species));
  if (!base) throw new Error(`Unknown species: ${species}`);
  const formes = snapshot ? previewFormes(base.name, snapshot) : [];
  const archetypes = ctx.team ? detectArchetypes(ctx.team, snapshot) : [];
  const model = !snapshot || formes.length === 0 ? await fallbackModel(base.name, !!snapshot) : metaModel(base, formes, snapshot, archetypes);
  model.archetypes = archetypes;
  const personal = ctx.history?.length ? applyHistory(model, ctx.history) : model;
  return ctx.reveals ? applyReveals(personal, ctx.reveals) : personal;
}

function metaModel(base: NonNullable<ReturnType<typeof getSpecies>>, formes: string[], snapshot: MetaSnapshot, archetypes: Archetype[]): OpponentModel {
  const totalUsage = formes.reduce((s, f) => s + snapshot.pokemon[f]!.usage, 0);
  const candidates: OpponentCandidate[] = [];
  const tags = new Set<string>();
  let rawCount = 0;

  for (const f of formes) {
    const mon = snapshot.pokemon[f]!;
    rawCount += mon.rawCount;
    const pForme = mon.usage / totalUsage;
    const isMega = !!getSpecies(f)!.isMega;

    const spreads = topEntries(mon.spreads, MAX_SPREADS + (archetypes.includes('trickroom') ? 3 : 0))
      .map(([k, p]) => ({ s: parseSpread(k), p }))
      .filter((x) => x.s);
    const spreadSum = spreads.reduce((a, b) => a + b.p, 0) || 1;
    let items: [string, number][] = isMega ? topEntries(mon.items, 1) : topEntries(mon.items, MAX_ITEMS);
    if (!isMega) for (const d of DANGEROUS_ITEMS) if ((mon.items[d] ?? 0) >= 0.05 && !items.some(([i]) => i === d)) items = [...items, [d, mon.items[d]!]];
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
    for (const d of DANGEROUS_ITEMS) if ((mon.items[d] ?? 0) >= 0.05) tags.add(`${dex.items.get(d).name} ${Math.round(mon.items[d]! * 100)}%`);

    const itemList: [string, number][] = items.length ? items : [['', 1]];
    for (const { s, p: pS } of spreads) {
      const af = archetypeFactor(s!.alignment, s!.sp.spe, archetypes);
      for (const [itemId, pI] of itemList) {
        const item = itemId ? dex.items.get(itemId).name : undefined;
        candidates.push({
          build: makeBuild({
            species: base.name,
            ability: isMega ? base.abilities[0] : ability,
            item,
            alignment: s!.alignment,
            moves: likelyMoves.slice(0, 4).map((m) => m.move),
            sp: s!.sp,
          }),
          weight: pForme * (pS / spreadSum) * (pI / itemSum) * af,
          likelyMoves,
          forme: f,
          label: `${f} · ${s!.alignment} ${Object.values(s!.sp).join('/')}${item ? ` · ${item}` : ''}`,
        });
      }
    }
  }

  // Keep the top candidates by weight, but always keep a dangerous-item variant if one exists.
  candidates.sort((a, b) => b.weight - a.weight);
  const total0 = candidates.reduce((a, c) => a + c.weight, 0) || 1;
  const kept = candidates.filter((c, i) => c.weight / total0 >= MIN_CANDIDATE_W && i < MAX_CANDIDATES);
  for (const d of DANGEROUS_ITEMS) {
    const v = candidates.find((c) => toID(c.build.item ?? '') === d);
    if (v && !kept.includes(v)) kept.push(v);
  }
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
    archetypes,
    updatedByReveals: false,
    notes: [
      `Hasta ${MAX_CANDIDATES} builds por especie (spreads × objetos), más variantes peligrosas (Scarf/Sash ≥ 5%).`,
      ...(archetypes.length ? [`Pesos ajustados al arquetipo del equipo rival: ${archetypes.map((a) => ARCHETYPE_LABEL[a]).join(', ')}.`] : []),
      ...(rel === 'low' ? ['Muestra pequeña: estas builds son poco fiables.'] : []),
    ],
  };
}

/** Bayesian filter with a 0/1 likelihood: drop sets that contradict what was seen. */
export function applyReveals(model: OpponentModel, r: Reveals): OpponentModel {
  const revealedMoves = (r.moves ?? []).map((m) => dex.moves.get(m)).filter((m) => m.exists).map((m) => m.name);
  if (!r.item && !r.ability && !revealedMoves.length) return model;
  let cands = model.candidates.filter((c) => consistent(c, r));
  const notes = [...model.notes];
  if (!cands.length) {
    const top = model.candidates[0]!;
    const item = r.item ? dex.items.get(r.item).name : top.build.item;
    cands = [{ ...top, weight: 1, build: { ...top.build, item, ability: r.ability ?? top.build.ability }, label: `${model.species} · set sintetizado con lo revelado${item ? ` · ${item}` : ''}` }];
    notes.push('Lo revelado no coincide con ninguna build frecuente: set sintetizado (hipótesis).');
  } else {
    notes.push(`Actualizado con lo revelado: quedan ${cands.length} de ${model.candidates.length} builds.`);
  }
  const sum = cands.reduce((a, c) => a + c.weight, 0) || 1;
  cands = cands.map((c) => {
    const known = new Set(c.likelyMoves.map((m) => toID(m.move)));
    const extra = revealedMoves.filter((m) => !known.has(toID(m))).map((move) => ({ move, p: 1 }));
    const likelyMoves = [...extra, ...c.likelyMoves.map((m) => (revealedMoves.some((x) => toID(x) === toID(m.move)) ? { ...m, p: 1 } : m))];
    return { ...c, weight: c.weight / sum, likelyMoves, build: { ...c.build, moves: [...new Set([...revealedMoves, ...c.build.moves])].slice(0, 4) } };
  });
  return { ...model, candidates: cands, notes, updatedByReveals: true };
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
    archetypes: [],
    updatedByReveals: false,
    notes: [hadSnapshot ? 'No aparece en las estadísticas de uso: build hipotética (máxima ofensiva y velocidad).' : 'Sin snapshot de meta cargado: build hipotética.'],
  };
}

/**
 * Personalisation from YOUR battle history without over-reading small samples.
 * Dirichlet-style update on the item distribution: posterior share of item i =
 *   (observed_i + α · prior_i) / (n + α), with α = 20 pseudo-observations.
 * With 1–3 observations the weights barely move; with 30+ your local meta dominates.
 */
export const HISTORY_ALPHA = 20;

export function applyHistory(model: OpponentModel, observations: Reveals[]): OpponentModel {
  const obs = observations.filter((o) => o.item);
  if (!obs.length || model.source !== 'meta') return model;
  const n = obs.length;
  const prior = new Map<string, number>();
  for (const c of model.candidates) prior.set(toID(c.build.item ?? ''), (prior.get(toID(c.build.item ?? '')) ?? 0) + c.weight);
  const counts = new Map<string, number>();
  for (const o of obs) counts.set(toID(o.item!), (counts.get(toID(o.item!)) ?? 0) + 1);
  const cands = model.candidates.map((c) => {
    const id = toID(c.build.item ?? '');
    const p = prior.get(id) ?? 0;
    const post = ((counts.get(id) ?? 0) + HISTORY_ALPHA * p) / (n + HISTORY_ALPHA);
    return { ...c, weight: p > 0 ? (c.weight * post) / p : c.weight };
  });
  const sum = cands.reduce((s, c) => s + c.weight, 0) || 1;
  for (const c of cands) c.weight /= sum;
  cands.sort((a, b) => b.weight - a.weight);
  return { ...model, candidates: cands, notes: [...model.notes, `Ajustado con tu historial: ${n} objeto(s) observado(s) en tus combates (peso ${(n / (n + HISTORY_ALPHA)).toFixed(2)} frente al meta global).`] };
}
