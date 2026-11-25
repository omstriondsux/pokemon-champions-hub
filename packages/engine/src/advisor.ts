import { dex, toID } from './data/dex.js';
import { calcDamage, finalSpeed } from './damage.js';
import type { Build } from './build.js';
import type { OpponentModel } from './opponent.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';
import type { MetaSnapshotMeta } from './meta.js';

/**
 * Battle Advisor — team preview selection.
 *
 * 1. Matchup matrix: for each (my Pokémon i, opponent species o), a 1v1 index s(i,o) ∈ [-1, 1]
 *    from exact damage calcs (expected hits to KO each way) and speed, averaged over the opponent's
 *    candidate sets. We also keep the WORST case over plausible sets (rare but dangerous builds).
 * 2. Exhaustive search: every selection S (C(6,k)) against every opponent selection T (C(6,k)).
 *    C(6,4)=15 or C(6,3)=20 per side, so ≤ 400 cells: no heuristic search needed.
 * 3. Three alternatives: best average, best worst-case (CVaR 25%), best upside (top 25%).
 *
 * The index is a HEURISTIC, not a win probability. It ignores switching, positioning and most
 * support effects; the factors listed in the output say what was and was not considered.
 */

export interface PairDetail {
  myBestMove?: string;
  myDamagePct?: [number, number];
  myHitsToKO: number; // expected uses to KO (capped at 5)
  theirBestMove?: string;
  theirDamagePct?: [number, number];
  theirHitsToKO: number;
  mySpeed: number;
  theirSpeed: number;
  pFirst: number; // P(I move first), over candidate sets
}

export interface PairResult {
  score: number; // weighted over candidates
  worst: number; // worst score among candidates with weight ≥ 5%
  worstLabel?: string;
  worstWeight?: number;
  detail: PairDetail; // for the most likely candidate
}

export interface AdvisorOptions {
  format: FormatId;
  trickRoom?: boolean; // evaluate under Trick Room (speed order reversed)
}

const HIT_CAP = 5;
const DAMAGING = (m: string) => {
  const mv = dex.moves.get(m);
  return mv.exists && mv.category !== 'Status';
};

/** E[min(N, 5)] where N = uses needed to KO. From koChance[n] = P(KO within n+1 uses). */
function expectedHits(ko: readonly number[]): number {
  let e = 1;
  for (let n = 0; n < 4; n++) e += 1 - ko[n]!;
  return Math.min(HIT_CAP, e);
}

interface BestHit {
  move?: string;
  hits: number;
  pct?: [number, number];
}

/** Best move by expected uses-to-KO. Screening without crits, then the winner is re-scored exactly. */
function bestHit(attacker: Build, defender: Build, moves: string[], reg: Regulation, gameType: 'Singles' | 'Doubles'): BestHit {
  let bestMove: string | undefined;
  let bestHits = Infinity;
  for (const m of moves) {
    if (!DAMAGING(m)) continue;
    try {
      const r = calcDamage(attacker, defender, m, reg, { field: { gameType }, ignoreCrit: true });
      const hits = expectedHits(r.koChance);
      if (hits < bestHits) (bestHits = hits), (bestMove = m);
    } catch {
      /* moves the calc cannot model are skipped */
    }
  }
  if (!bestMove) return { hits: HIT_CAP };
  const r = calcDamage(attacker, defender, bestMove, reg, { field: { gameType } });
  return { move: r.move, hits: expectedHits(r.koChance), pct: [r.minPct, r.maxPct] };
}

/** Memo of pair evaluations: the same (my build, rival model) pair recurs across advisor, dashboard and squad builder. */
const pairCache = new Map<string, PairResult>();
const PAIR_CACHE_MAX = 20_000;
function pairKey(mine: Build, opp: OpponentModel, reg: Regulation, opts: AdvisorOptions) {
  return `${reg.id}@${reg.pack.packVersion}|${opts.format}|${opts.trickRoom ? 1 : 0}|${JSON.stringify(mine)}|${opp.species}|${opp.candidates.map((c) => `${c.label}:${c.weight.toFixed(4)}:${c.likelyMoves.length}`).join(',')}`;
}
export const clearPairCache = () => pairCache.clear();

export function pairScore(myHits: number, theirHits: number, pFirst: number): number {
  return Math.max(-1, Math.min(1, (theirHits - myHits + (pFirst - 0.5)) / 2));
}

export function evaluatePair(mine: Build, opp: OpponentModel, reg: Regulation, opts: AdvisorOptions): PairResult {
  const key = pairKey(mine, opp, reg, opts);
  const hit = pairCache.get(key);
  if (hit) return hit;
  const res = evaluatePairUncached(mine, opp, reg, opts);
  if (pairCache.size >= PAIR_CACHE_MAX) pairCache.clear();
  pairCache.set(key, res);
  return res;
}

function evaluatePairUncached(mine: Build, opp: OpponentModel, reg: Regulation, opts: AdvisorOptions): PairResult {
  const gameType = reg.format(opts.format).gameType;
  const mySpeed = finalSpeed(mine, reg);
  let score = 0;
  let worst = Infinity;
  let worstLabel: string | undefined;
  let worstWeight: number | undefined;
  let detail: PairDetail | undefined;
  let pFirstAcc = 0;

  for (const c of opp.candidates) {
    const mineHit = bestHit(mine, c.build, mine.moves, reg, gameType);
    const theirHit = bestHit(c.build, mine, c.likelyMoves.map((m) => m.move), reg, gameType);
    const theirSpeed = finalSpeed(c.build, reg);
    let pFirst = mySpeed > theirSpeed ? 1 : mySpeed === theirSpeed ? 0.5 : 0;
    if (opts.trickRoom) pFirst = 1 - pFirst;
    const s = pairScore(mineHit.hits, theirHit.hits, pFirst);
    score += c.weight * s;
    pFirstAcc += c.weight * pFirst;
    if (c.weight >= 0.05 && s < worst) {
      worst = s;
      worstLabel = c.label;
      worstWeight = c.weight;
    }
    if (!detail) {
      detail = {
        myBestMove: mineHit.move,
        myDamagePct: mineHit.pct,
        myHitsToKO: mineHit.hits,
        theirBestMove: theirHit.move,
        theirDamagePct: theirHit.pct,
        theirHitsToKO: theirHit.hits,
        mySpeed,
        theirSpeed,
        pFirst,
      };
    }
  }
  detail!.pFirst = pFirstAcc;
  return { score, worst: worst === Infinity ? score : worst, worstLabel, worstWeight, detail: detail! };
}

export function combinations<T>(items: T[], k: number): T[][] {
  const out: T[][] = [];
  const rec = (start: number, acc: T[]) => {
    if (acc.length === k) return void out.push([...acc]);
    for (let i = start; i < items.length; i++) rec(i + 1, [...acc, items[i]!]);
  };
  rec(0, []);
  return out;
}

/** Value of my selection S vs their selection T: coverage (each of theirs has an answer) + overall matchup. */
export function selectionValue(S: number[], T: number[], M: number[][]): number {
  let coverage = 0;
  for (const o of T) coverage += Math.max(...S.map((i) => M[i]![o]!));
  let overall = 0;
  for (const i of S) for (const o of T) overall += M[i]![o]!;
  return 0.6 * (coverage / T.length) + 0.4 * (overall / (S.length * T.length));
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
function tailMean(a: number[], q: number, upper: boolean) {
  const sorted = [...a].sort((x, y) => (upper ? y - x : x - y));
  return mean(sorted.slice(0, Math.max(1, Math.ceil(sorted.length * q))));
}

export interface Alternative {
  kind: 'best' | 'conservative' | 'aggressive';
  members: number[]; // indexes into my team
  leads: number[]; // 2 in doubles, 1 in singles
  back: number[];
  expected: number; // E_T[V]
  worstQuartile: number; // CVaR 25%
  bestQuartile: number;
  sameAs?: Alternative['kind'];
  strengths: string[];
  risks: string[];
  winConditions: string[];
  leadFactors: string[];
  /** Support value credited to this selection (speed control, Intimidate, Fake Out…), with reasons. */
  support: number;
  supportFactors: string[];
}

export interface Threat {
  opp: number;
  species: string;
  threat: number; // mean over my team of -s(i,o): > 0 means it beats my team on average
  answers: { member: number; score: number }[];
  noAnswer: boolean;
  dangerousVariant?: { label: string; weight: number; worst: number };
}

export interface AdvisorResult {
  format: FormatId;
  bring: number;
  bringConfidence: string;
  matrix: PairResult[][]; // [myIndex][oppIndex]
  threats: Threat[];
  alternatives: Alternative[];
  opponents: { species: string; reliability: OpponentModel['reliability']; usage: number; tags: string[]; candidates: number; notes: string[] }[];
  evidence: string[];
  limitations: string[];
  elapsedMs: number;
}

const FAKE_OUT = new Set(['fakeout']);
const SPEED_CONTROL = new Set(['tailwind', 'trickroom', 'icywind', 'electroweb', 'thunderwave', 'bulldoze']);
const REDIRECT = new Set(['followme', 'ragepowder']);

function leadSupport(b: Build): { bonus: number; why: string[] } {
  const ids = b.moves.map(toID);
  const why: string[] = [];
  let bonus = 0;
  if (ids.some((m) => FAKE_OUT.has(m))) (bonus += 0.08), why.push(`${b.species}: Fake Out`);
  if (ids.some((m) => SPEED_CONTROL.has(m))) (bonus += 0.08), why.push(`${b.species}: control de velocidad`);
  if (ids.some((m) => REDIRECT.has(m))) (bonus += 0.06), why.push(`${b.species}: redirección`);
  if (toID(b.ability) === 'intimidate') (bonus += 0.05), why.push(`${b.species}: Intimidate`);
  return { bonus, why };
}

function chooseLeads(S: number[], team: Build[], M: number[][], oppCount: number, doubles: boolean) {
  const opp = [...Array(oppCount).keys()];
  if (!doubles) {
    // Singles: the lead that does best on average vs any of their 6 (they could lead with any).
    const lead = [...S].sort((a, b) => mean(opp.map((o) => M[b]![o]!)) - mean(opp.map((o) => M[a]![o]!)))[0]!;
    return { leads: [lead], back: S.filter((i) => i !== lead), factors: [`${team[lead]!.species}: mejor índice medio frente a los 6 rivales`] };
  }
  const oppPairs = combinations(opp, 2);
  let best = { leads: [] as number[], v: -Infinity, factors: [] as string[] };
  for (const L of combinations(S, 2)) {
    const base = mean(oppPairs.map((P) => mean(P.map((o) => Math.max(...L.map((i) => M[i]![o]!))))));
    const sup = L.map((i) => leadSupport(team[i]!));
    const bonus = Math.min(0.15, sup.reduce((a, s) => a + s.bonus, 0));
    if (base + bonus > best.v) best = { leads: L, v: base + bonus, factors: [`Cobertura media vs leads rivales: ${base.toFixed(2)}`, ...sup.flatMap((s) => s.why)] };
  }
  return { leads: best.leads, back: S.filter((i) => !best.leads.includes(i)), factors: best.factors };
}


/**
 * Support value of a selection against a rival selection. The 1v1 index cannot see what support
 * Pokémon do, so their contribution is credited here explicitly and bounded (≤ 0.20, halved in singles).
 * Each term is tied to the actual rival team: Intimidate is worth more against physical attackers,
 * Tailwind/Trick Room more when the rivals are faster than you.
 */
export interface SupportContext {
  mySpeed: number[];
  oppSpeed: number[];
  oppPhysical: number[]; // 0..1 share of the rival's plausible sets that are physical
  oppTrickRoom: boolean;
  doubles: boolean;
  team: Build[];
}

const SC_NON_TR = new Set(['tailwind', 'icywind', 'electroweb', 'thunderwave']);
const ANTI_TR = new Set(['taunt', 'imprison', 'trickroom']);

export function supportValue(S: number[], T: number[], ctx: SupportContext): { value: number; why: string[] } {
  const moves = (i: number): string[] => ctx.team[i]!.moves.map(toID);
  const has = (set: Set<string>) => S.filter((i) => moves(i).some((m) => set.has(m)));
  const why: string[] = [];
  let v = 0;
  let slower = 0;
  for (const i of S) for (const o of T) if (ctx.oppSpeed[o]! > ctx.mySpeed[i]!) slower++;
  const fracSlower = slower / (S.length * T.length);
  const phys = mean(T.map((o) => ctx.oppPhysical[o]!));

  if (ctx.doubles && has(FAKE_OUT).length) (v += 0.04), why.push(`Fake Out (${has(FAKE_OUT).map((i) => ctx.team[i]!.species).join(', ')})`);
  if (ctx.doubles && has(REDIRECT).length) (v += 0.04), why.push(`Redirección (${has(REDIRECT).map((i) => ctx.team[i]!.species).join(', ')})`);
  const intim = S.filter((i) => toID(ctx.team[i]!.ability) === 'intimidate');
  if (intim.length && phys > 0) {
    const x = 0.08 * phys * (intim.length > 1 ? 1.5 : 1);
    v += x;
    why.push(`Intimidate contra ${(phys * 100).toFixed(0)}% de sets físicos rivales (+${x.toFixed(2)})`);
  }
  const sc = has(SC_NON_TR);
  if (sc.length && fracSlower > 0) {
    const x = 0.1 * fracSlower;
    v += x;
    why.push(`Control de velocidad (${sc.map((i) => ctx.team[i]!.species).join(', ')}): eres más lento en el ${(fracSlower * 100).toFixed(0)}% de los cruces (+${x.toFixed(2)})`);
  }
  const tr = S.filter((i) => moves(i).includes('trickroom'));
  if (tr.length && fracSlower > 0.4) {
    const x = (0.14 * (fracSlower - 0.4)) / 0.6;
    v += x;
    why.push(`Trick Room (${tr.map((i) => ctx.team[i]!.species).join(', ')}) favorece a tu selección lenta (+${x.toFixed(2)})`);
  }
  if (ctx.oppTrickRoom && has(ANTI_TR).length) (v += 0.04), why.push('Respuesta al Trick Room rival (Taunt/Imprison/TR propio)');
  v = Math.min(0.2, v) * (ctx.doubles ? 1 : 0.5);
  return { value: v, why };
}

const fmt = (x: number) => (x >= 0 ? '+' : '') + x.toFixed(2);

export function adviseSelection(
  team: Build[],
  opponents: OpponentModel[],
  reg: Regulation,
  opts: AdvisorOptions,
  snapshotMeta?: MetaSnapshotMeta,
): AdvisorResult {
  const t0 = performance.now();
  const rules = reg.format(opts.format);
  const k = Math.min(rules.bring.value, team.length);
  const kOpp = Math.min(rules.bring.value, opponents.length);
  const doubles = rules.gameType === 'Doubles';

  const matrix = team.map((b) => opponents.map((o) => evaluatePair(b, o, reg, opts)));
  const M = matrix.map((row) => row.map((p) => p.score));
  const W = matrix.map((row) => row.map((p) => p.worst));

  const mine = [...team.keys()];
  const theirs = [...opponents.keys()];
  const Ss = combinations(mine, k);
  const Ts = combinations(theirs, kOpp); // uniform over their selections: we have no data on what they bring

  const sctx: SupportContext = {
    mySpeed: team.map((b) => finalSpeed(b, reg)),
    oppSpeed: opponents.map((o) => o.candidates.reduce((s, c) => s + c.weight * finalSpeed(c.build, reg), 0)),
    oppPhysical: opponents.map((o) => o.candidates.reduce((s, c) => s + c.weight * (c.build.sp.atk >= c.build.sp.spa ? 1 : 0), 0)),
    oppTrickRoom: opponents.some((o) => o.archetypes?.includes('trickroom')),
    doubles,
    team,
  };
  if (opts.trickRoom) [sctx.mySpeed, sctx.oppSpeed] = [sctx.mySpeed.map((x) => -x), sctx.oppSpeed.map((x) => -x)];

  const scored = Ss.map((S) => {
    const sup = Ts.map((T) => supportValue(S, T, sctx).value);
    const vals = Ts.map((T, j) => selectionValue(S, T, M) + sup[j]!);
    const robust = Ts.map((T, j) => selectionValue(S, T, W) + sup[j]!);
    return { S, expected: mean(vals), worstQuartile: tailMean(robust, 0.25, false), bestQuartile: tailMean(vals, 0.25, true) };
  });

  const pick = (key: 'expected' | 'worstQuartile' | 'bestQuartile') => [...scored].sort((a, b) => b[key] - a[key] || b.expected - a.expected)[0]!;
  const picks: [Alternative['kind'], ReturnType<typeof pick>][] = [
    ['best', pick('expected')],
    ['conservative', pick('worstQuartile')],
    ['aggressive', pick('bestQuartile')],
  ];

  const alternatives: Alternative[] = [];
  for (const [kind, p] of picks) {
    const same = alternatives.find((a) => a.members.join() === p.S.join());
    const { leads, back, factors } = chooseLeads(p.S, team, M, opponents.length, doubles);
    const strengths: string[] = [];
    const risks: string[] = [];
    for (const o of theirs) {
      const bestI = p.S.reduce((a, i) => (M[i]![o]! > M[a]![o]! ? i : a), p.S[0]!);
      const s = M[bestI]![o]!;
      const d = matrix[bestI]![o]!.detail;
      const name = opponents[o]!.species;
      if (s >= 0.35) strengths.push(`${team[bestI]!.species} gana el 1v1 a ${name} (${fmt(s)}): ${d.myBestMove ?? '—'} lo deja en ~${d.myHitsToKO.toFixed(1)} usos.`);
      if (s < 0) risks.push(`Nadie de la selección gana a ${name} (mejor: ${team[bestI]!.species} ${fmt(s)}).`);
      const w = W[bestI]![o]!;
      const pr = matrix[bestI]![o]!;
      if (s >= 0 && w < -0.25 && pr.worstLabel) risks.push(`Variante peligrosa de ${name}: ${pr.worstLabel} (${((pr.worstWeight ?? 0) * 100).toFixed(0)}% de sus builds) da vuelta el 1v1 de ${team[bestI]!.species} (${fmt(w)}).`);
    }
    const supAll = supportValue(p.S, theirs, sctx);
    const offense = p.S.map((i) => ({ i, v: mean(theirs.map((o) => 1 / matrix[i]![o]!.detail.myHitsToKO)) })).sort((a, b) => b.v - a.v);
    const winConditions = offense.slice(0, 2).map(({ i, v }) => `${team[i]!.species}: mayor presión ofensiva (≈${(1 / v).toFixed(1)} usos de media para un KO).`);
    alternatives.push({
      kind,
      members: p.S,
      leads,
      back,
      expected: p.expected,
      worstQuartile: p.worstQuartile,
      bestQuartile: p.bestQuartile,
      sameAs: same?.kind,
      support: supAll.value,
      supportFactors: supAll.why,
      strengths: strengths.slice(0, 4),
      risks: risks.slice(0, 5),
      winConditions,
      leadFactors: factors,
    });
  }

  const threats: Threat[] = theirs
    .map((o) => {
      const answers = mine.map((i) => ({ member: i, score: M[i]![o]! })).filter((a) => a.score >= 0.25).sort((a, b) => b.score - a.score);
      // A variant is "dangerous" only if it flips one of my answers (a matchup I normally win) into a loss.
      const flipped = answers.map((a) => matrix[a.member]![o]!).filter((p) => p.worst < 0 && p.worstLabel);
      const worstPair = flipped.sort((a, b) => a.worst - b.worst)[0];
      return {
        opp: o,
        species: opponents[o]!.species,
        threat: mean(mine.map((i) => -M[i]![o]!)),
        answers,
        noAnswer: answers.length === 0,
        dangerousVariant: worstPair ? { label: worstPair.worstLabel!, weight: worstPair.worstWeight ?? 0, worst: worstPair.worst } : undefined,
      };
    })
    .sort((a, b) => b.threat - a.threat);

  const evidence = [
    'Daño: @smogon/calc (mecánicas de Champions) con las 16 tiradas exactas, precisión y críticos.',
    snapshotMeta
      ? `Builds rivales: estadísticas de Smogon ${snapshotMeta.month}, ${snapshotMeta.showdownFormat}, rating ≥ ${snapshotMeta.ratingCutoff}, ${snapshotMeta.battles.toLocaleString()} combates (simulador, no datos oficiales).`
      : 'Builds rivales: sin snapshot de meta, todas son hipótesis.',
    `Selección: búsqueda exhaustiva de ${Ss.length} selecciones propias × ${Ts.length} rivales (supuestas equiprobables).`,
  ];
  const limitations = [
    'El índice 1v1 es heurístico, no una probabilidad de victoria.',
    'No modela cambios, posicionamiento, estados alterados, prioridad ni daño residual.',
    'El apoyo (Fake Out, Intimidate, control de velocidad, redirección, Trick Room) se suma como bonus acotado (≤ 0,20), ligado al equipo rival.',
    doubles ? 'Dobles: los movimientos de área aplican la reducción ×0,75; los combos de dos atacantes y el apoyo se valoran solo con bonus en los leads.' : 'Individuales: 1v1 directos.',
    ...(rules.bring.confidence !== 'verified' ? [`Número de Pokémon a elegir (${rules.bring.value}): regla "${rules.bring.confidence}" en el paquete ${reg.id}.`] : []),
    ...(opts.trickRoom ? ['Evaluado bajo Trick Room (orden de velocidad invertido).'] : []),
  ];

  return {
    format: opts.format,
    bring: k,
    bringConfidence: rules.bring.confidence,
    matrix,
    threats,
    alternatives,
    opponents: opponents.map((o) => ({ species: o.species, reliability: o.reliability, usage: o.usage, tags: o.tags, candidates: o.candidates.length, notes: o.notes })),
    evidence,
    limitations,
    elapsedMs: performance.now() - t0,
  };
}
