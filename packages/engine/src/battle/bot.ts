/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Battle } from '@pkmn/sim';
import type { StatTable } from '../build.js';
import { championsStats, restore, serialize } from './sim.js';

/**
 * The AI opponent.
 *
 * Each turn it builds a payoff table by SIMULATING the turn with Showdown's engine:
 * rows = its candidate joint actions, columns = the human's likely replies, value = how much better
 * its position is afterwards. Then it solves that zero-sum game with regret matching (converges to a
 * Nash equilibrium) and samples its move from the mixed strategy — so it can't be read.
 *
 * Fairness: it never sees the human's choice for the turn, and it does not know the human's real
 * Stat Points: before thinking, the human's Pokémon get the meta's most common spread instead.
 * Moves, items and abilities are known because Reg M-C is played with open team sheets.
 */

export type SideID = 'p1' | 'p2';
export interface SpreadGuess {
  alignment: string;
  sp: StatTable;
}
export interface BotContext {
  /** species → the spread the bot assumes for the human's Pokémon */
  guesses: Record<string, SpreadGuess>;
  /** human Pokémon already seen on the field (the bot can't plan around unrevealed back Pokémon) */
  revealed: Set<string>;
  /** effort: 1 (fast) … 3 (strong) */
  depth?: number;
  rng?: () => number;
}
export interface Option {
  choice: string;
  label: string;
}
export interface BotDecision {
  choice: string;
  label: string;
  strategy: { label: string; choice: string; prob: number; value: number }[];
  predicted: { label: string; prob: number }[];
  value: number; // game value for the bot (− = it thinks it is losing the turn)
  sims: number;
  ms: number;
}

const foeOf = (s: SideID): SideID => (s === 'p1' ? 'p2' : 'p1');
const sideIdx = (s: SideID) => (s === 'p1' ? 0 : 1);

// ---------------------------------------------------------------- options

function targetsFor(target: string, slot: number, doubles: boolean, foeAlive: boolean[]): (number | undefined)[] {
  if (!doubles) return [undefined];
  const ally = slot === 0 ? -2 : -1;
  switch (target) {
    case 'normal':
    case 'any':
    case 'adjacentFoe': {
      const t = [1, 2].filter((n) => foeAlive[n - 1]);
      return t.length ? t : [1];
    }
    case 'adjacentAlly':
      return [ally];
    case 'adjacentAllyOrSelf':
      return [ally];
    default:
      return [undefined];
  }
}

/** Every legal option for each active slot of `side`, read from the engine's own request. */
export function slotOptions(battle: Battle, side: SideID, revealedOnly?: Set<string>): Option[][] {
  const s = battle.sides[sideIdx(side)] as any;
  const req = s.activeRequest;
  if (!req || req.wait || req.teamPreview) return [];
  const doubles = battle.gameType === 'doubles';
  const foe = battle.sides[sideIdx(foeOf(side))] as any;
  const foeAlive = [0, 1].map((i) => !!foe.active[i] && !foe.active[i].fainted);
  const team: any[] = req.side.pokemon;
  const bench = team
    .map((p: any, i: number) => ({ p, i }))
    .filter(({ p }) => !p.active && !String(p.condition).endsWith('fnt'))
    .filter(({ p }) => !revealedOnly || revealedOnly.has(speciesOf(p.details)));
  const out: Option[][] = [];

  if (req.forceSwitch) {
    (req.forceSwitch as boolean[]).forEach((must, slot) => {
      if (!must) return out.push([{ choice: 'pass', label: '—' }]);
      const opts = bench.map(({ p, i }) => ({ choice: `switch ${i + 1}`, label: `Entra ${speciesOf(p.details)}` }));
      out.push(opts.length ? opts : [{ choice: 'pass', label: '—' }]);
    });
    return out;
  }

  (req.active as any[]).forEach((a, slot) => {
    const me = s.active[slot];
    if (!me || me.fainted) return out.push([{ choice: 'pass', label: '—' }]);
    const opts: Option[] = [];
    const name = me.species.name;
    const protectedLastTurn = !!me.volatiles?.stall;
    (a.moves as any[]).forEach((m, j) => {
      if (m.disabled || (m.pp !== undefined && m.pp <= 0 && !a.trapped)) return;
      if (protectedLastTurn && PROTECT_RE.test(m.move)) return; // 1/3 success: never worth planning around
      for (const t of targetsFor(m.target, slot, doubles, foeAlive)) {
        const tName = t === undefined ? '' : t > 0 ? foe.active[t - 1]?.species?.name ?? `rival ${t}` : 'aliado';
        const mega = a.canMegaEvo ? ' mega' : '';
        opts.push({ choice: `move ${j + 1}${t === undefined ? '' : ` ${t}`}${mega}`, label: `${name}: ${m.move}${tName ? ` → ${tName}` : ''}` });
      }
    });
    if (!a.trapped && !a.maybeTrapped) for (const { p, i } of bench) opts.push({ choice: `switch ${i + 1}`, label: `${name} → cambia a ${speciesOf(p.details)}` });
    out.push(opts.length ? opts : [{ choice: 'default', label: `${name}: lo que pueda` }]);
  });
  return out;
}

const speciesOf = (details: string) => String(details).split(',')[0]!;

/** Cartesian product of per-slot options, dropping illegal combinations (same switch twice, two megas). */
export function joint(slots: Option[][]): Option[] {
  if (!slots.length) return [];
  let acc: { parts: Option[] }[] = [{ parts: [] }];
  for (const opts of slots) acc = acc.flatMap((a) => opts.map((o) => ({ parts: [...a.parts, o] })));
  return acc
    .filter(({ parts }) => {
      const sw = parts.map((p) => p.choice).filter((c) => c.startsWith('switch'));
      if (new Set(sw).size !== sw.length) return false;
      return parts.filter((p) => p.choice.endsWith(' mega')).length <= 1;
    })
    .map(({ parts }) => ({ choice: parts.map((p) => p.choice).join(', '), label: parts.map((p) => p.label).filter((l) => l !== '—').join(' · ') }));
}

// ---------------------------------------------------------------- evaluation

/** Position value from `side`'s point of view. Fainted = 0, alive ≈ 0.35 + 0.65·HP%. */
export function evaluate(battle: Battle, side: SideID): number {
  if (battle.ended) return battle.winner === battle.sides[sideIdx(side)]!.name ? 100 : battle.winner ? -100 : 0;
  const sideValue = (k: number) => {
    const s = battle.sides[k] as any;
    let v = 0;
    for (const p of s.pokemon as any[]) {
      if (p.fainted || p.hp <= 0) continue;
      let m = ALIVE + (1 - ALIVE) * (p.hp / p.maxhp);
      if (p.status === 'slp' || p.status === 'frz') m -= 0.15;
      else if (p.status === 'par' || p.status === 'brn' || p.status === 'tox' || p.status === 'psn') m -= 0.07;
      // costs a one-turn horizon can't see: a wasted next turn (Hyper Beam & co.), Perish Song counting down
      if (p.volatiles?.mustrecharge) m -= 0.3;
      if (p.volatiles?.perishsong) m -= 0.25 * (4 - (p.volatiles.perishsong.duration ?? 3));
      if (p.isActive) {
        const b = p.boosts as Record<string, number>;
        m += 0.03 * Math.max(-4, Math.min(4, (b.atk ?? 0) + (b.spa ?? 0) + 0.5 * ((b.def ?? 0) + (b.spd ?? 0)) + (b.spe ?? 0)));
      }
      v += m;
    }
    const sc = s.sideConditions as Record<string, any>;
    if (sc.tailwind) v += 0.12 * (sc.tailwind.duration ?? 2);
    if (sc.reflect) v += 0.06 * (sc.reflect.duration ?? 2);
    if (sc.lightscreen) v += 0.06 * (sc.lightscreen.duration ?? 2);
    if (sc.auroraveil) v += 0.08 * (sc.auroraveil.duration ?? 2);
    return v;
  };
  // A one-turn horizon over-values passive play (Protect/switch "lose nothing" this turn), so progress
  // against the foe weighs slightly more than damage avoided.
  return sideValue(sideIdx(side)) - AGGRESSION * sideValue(sideIdx(foeOf(side)));
}
const AGGRESSION = 1.15;
const ALIVE = 0.35; // a Pokémon still standing is worth this much even at 1 HP

/** Replace the human's real stats with the guessed meta spread (keeps HP %). */
function maskFoe(battle: Battle, botSide: SideID, guesses: Record<string, SpreadGuess>) {
  const foe = battle.sides[sideIdx(foeOf(botSide))] as any;
  for (const p of foe.pokemon as any[]) {
    const g = guesses[p.baseSpecies?.name ?? p.species.name] ?? guesses[p.species.name];
    if (!g) continue;
    try {
      const st = championsStats(p.species.name, g.sp, g.alignment);
      const frac = p.maxhp ? p.hp / p.maxhp : 1;
      p.maxhp = st.hp;
      p.baseMaxhp = st.hp;
      p.hp = p.fainted ? 0 : Math.max(1, Math.round(frac * st.hp));
      const stored = { atk: st.atk, def: st.def, spa: st.spa, spd: st.spd, spe: st.spe };
      p.storedStats = { ...stored };
      p.baseStoredStats = { ...stored };
    } catch {
      /* unknown species for the guess: keep engine stats */
    }
  }
}

/** Simulate one turn from `json` with the two choices; returns the value for `side` (NaN if a choice is illegal). */
function simulate(json: unknown, side: SideID, mine: string, theirs: string, seed: number[]): number {
  const b = restore(json, seed);
  const turn = b.turn;
  const pending = (sd: SideID) => {
    const r = (b.sides[sideIdx(sd)] as any).activeRequest;
    return !!r && !r.wait;
  };
  if (pending(side) && !b.choose(side, mine)) return NaN;
  if (!b.ended && pending(foeOf(side)) && !b.choose(foeOf(side), theirs)) return NaN;
  // finish mid-turn switches (U-turn, Eject Button…) with the engine's default choice
  for (let k = 0; k < 4 && !b.ended && b.turn === turn; k++) {
    let progressed = false;
    for (const sd of ['p1', 'p2'] as SideID[]) {
      const r = (b.sides[sideIdx(sd)] as any).activeRequest;
      if (r && !r.wait && !(b.sides[sideIdx(sd)] as any).isChoiceDone?.()) progressed = b.choose(sd, 'default') || progressed;
    }
    if (!progressed) break;
  }
  return evaluate(b, side);
}

/** Regret matching on a zero-sum matrix A (row player maximises). Returns both average strategies. */
export function solveZeroSum(A: number[][], iters = 3000): { row: number[]; col: number[]; value: number } {
  const n = A.length;
  const m = A[0]?.length ?? 0;
  const rRow = new Array(n).fill(0);
  const rCol = new Array(m).fill(0);
  const sRow = new Array(n).fill(0);
  const sCol = new Array(m).fill(0);
  const norm = (r: number[]) => {
    const pos = r.map((x) => Math.max(0, x));
    const t = pos.reduce((a, b) => a + b, 0);
    return t > 0 ? pos.map((x) => x / t) : r.map(() => 1 / r.length);
  };
  for (let it = 0; it < iters; it++) {
    const p = norm(rRow);
    const q = norm(rCol);
    const rowU = A.map((row) => row.reduce((s, a, j) => s + a * q[j]!, 0));
    const colU = Array.from({ length: m }, (_, j) => -A.reduce((s, row, i) => s + row[j]! * p[i]!, 0));
    const ev = rowU.reduce((s, u, i) => s + u * p[i]!, 0);
    const evc = colU.reduce((s, u, j) => s + u * q[j]!, 0);
    for (let i = 0; i < n; i++) rRow[i] += rowU[i]! - ev;
    for (let j = 0; j < m; j++) rCol[j] += colU[j]! - evc;
    for (let i = 0; i < n; i++) sRow[i] += p[i]!;
    for (let j = 0; j < m; j++) sCol[j] += q[j]!;
  }
  const row = sRow.map((x) => x / iters);
  const col = sCol.map((x) => x / iters);
  const value = A.reduce((s, r, i) => s + r.reduce((t, a, j) => t + a * row[i]! * col[j]!, 0), 0);
  return { row, col, value };
}

// ---------------------------------------------------------------- decision

const SEEDS = [
  [1, 2, 3, 4],
  [9, 8, 7, 6],
  [13, 21, 34, 55],
];

/** Decide `side`'s choice for the current request (moves or forced switch). */
export function decide(battle: Battle, side: SideID, ctx: BotContext): BotDecision {
  const t0 = performance.now();
  const rng = ctx.rng ?? Math.random;
  const depth = ctx.depth ?? 2;
  const seeds = SEEDS.slice(0, depth >= 3 ? 3 : 2);
  const keep = depth >= 3 ? 8 : depth === 2 ? 6 : 4;
  let sims = 0;

  const myReq = (battle.sides[sideIdx(side)] as any).activeRequest;
  if (myReq?.forceSwitch) return decideSwitch(battle, side, ctx, t0);
  const mineSlots = slotOptions(battle, side);
  const mineAll = joint(mineSlots);
  if (mineAll.length <= 1) {
    const only = mineAll[0] ?? { choice: 'default', label: 'Automático' };
    return { choice: only.choice, label: only.label, strategy: [{ ...only, prob: 1, value: 0 }], predicted: [], value: 0, sims: 0, ms: 0 };
  }
  const foeReq = (battle.sides[sideIdx(foeOf(side))] as any).activeRequest;
  const theirs0 = [{ choice: 'default', label: '—' }];

  // the position the bot reasons about: real for its side, guessed stats for the human's
  const base = restore(serialize(battle));
  maskFoe(base, side, ctx.guesses);
  const json = serialize(base);

  const val = (mine: string, theirs: string) => {
    let s = 0;
    let n = 0;
    for (const sd of seeds) {
      const v = simulate(json, side, mine, theirs, sd);
      sims++;
      if (Number.isNaN(v)) return NaN;
      s += v;
      n++;
    }
    return s / n;
  };

  // 1) rough cut, slot by slot (n1 + n2 simulations instead of n1 × n2):
  //    rank each Pokémon's options with its partner on a fixed default, keep the best few per slot,
  //    then rank the surviving combinations against the other side's best guess.
  const theirSlots = foeReq && !foeReq.wait ? slotOptions(battle, foeOf(side), ctx.revealed) : [];
  const perSlot = depth >= 3 ? 5 : depth === 2 ? 4 : 3;
  const defaultJoint = (slots: Option[][]) => ({ choice: slots.map((o) => o[0]!.choice).join(', '), label: '' });
  const rankSlots = (slots: Option[][], mineSide: boolean, ref: Option): Option[][] =>
    slots.map((opts, k) => {
      if (opts.length <= perSlot) return opts;
      const scored = opts
        .map((o) => {
          const c = slots.map((os, i) => (i === k ? o.choice : os[0]!.choice)).join(', ');
          const v = mineSide ? simulate(json, side, c, ref.choice, SEEDS[0]!) : -simulate(json, side, ref.choice, c, SEEDS[0]!);
          sims++;
          return { o, v };
        })
        .filter((x) => !Number.isNaN(x.v))
        .sort((a, b) => b.v - a.v)
        .map((x) => x.o);
      return withProtect(scored, perSlot);
    });
  const rankJoints = (cands: Option[], mineSide: boolean, ref: Option) =>
    cands
      .map((o) => {
        const v = mineSide ? simulate(json, side, o.choice, ref.choice, SEEDS[0]!) : -simulate(json, side, ref.choice, o.choice, SEEDS[0]!);
        sims++;
        return { o, v };
      })
      .filter((x) => !Number.isNaN(x.v))
      .sort((a, b) => b.v - a.v)
      .map((x) => x.o);
  const theirDefault = theirSlots.length ? defaultJoint(theirSlots) : theirs0[0]!;
  const myPruned = joint(rankSlots(mineSlots, true, theirDefault));
  const myDefault = myPruned[0] ?? mineAll[0]!;
  const theirPruned = theirSlots.length ? joint(rankSlots(theirSlots, false, myDefault)) : theirs0;
  const theirRank = rankJoints(theirPruned, false, myDefault);
  const myRank = rankJoints(myPruned, true, theirRank[0] ?? theirs0[0]!);
  const rows = withProtect(myRank, keep);
  const cols = withProtect(theirRank, keep);

  // 2) full payoff table and its equilibrium
  const A: number[][] = [];
  const okRows: Option[] = [];
  for (const r of rows) {
    const line = cols.map((c) => val(r.choice, c.choice));
    if (line.some((x) => Number.isNaN(x))) continue;
    A.push(line);
    okRows.push(r);
  }
  if (!A.length) return { choice: 'default', label: 'Automático', strategy: [], predicted: [], value: 0, sims, ms: performance.now() - t0 };
  const eq = solveZeroSum(A);
  // sample from the equilibrium (tiny probabilities are noise)
  const probs = eq.row.map((p) => (p < 0.03 ? 0 : p));
  const tot = probs.reduce((a, b) => a + b, 0) || 1;
  let x = rng() * tot;
  let pick = 0;
  for (let i = 0; i < probs.length; i++) {
    x -= probs[i]!;
    if (x <= 0) {
      pick = i;
      break;
    }
  }
  const strategy = okRows
    .map((o, i) => ({ ...o, prob: probs[i]! / tot, value: A[i]!.reduce((s, a, j) => s + a * eq.col[j]!, 0) }))
    .sort((a, b) => b.prob - a.prob);
  const predicted = cols.map((c, j) => ({ label: c.label, prob: eq.col[j]! })).filter((p) => p.prob >= 0.03).sort((a, b) => b.prob - a.prob);
  return { choice: okRows[pick]!.choice, label: okRows[pick]!.label, strategy, predicted, value: eq.value, sims, ms: performance.now() - t0 };
}

/** Forced switch (after a KO or a pivot move): try each switch-in and look one full turn ahead. */
function decideSwitch(battle: Battle, side: SideID, ctx: BotContext, t0: number): BotDecision {
  const opts = joint(slotOptions(battle, side));
  if (opts.length <= 1) {
    const only = opts[0] ?? { choice: 'default', label: 'Automático' };
    return { choice: only.choice, label: only.label, strategy: [{ ...only, prob: 1, value: 0 }], predicted: [], value: 0, sims: 0, ms: performance.now() - t0 };
  }
  let sims = 0;
  const scored = opts.map((o) => {
    const b = restore(serialize(battle), SEEDS[0]);
    if (!b.choose(side, o.choice)) return { o, v: NaN };
    const foe = foeOf(side);
    const fr = (b.sides[sideIdx(foe)] as any).activeRequest;
    if (!b.ended && fr && !fr.wait && fr.forceSwitch) b.choose(foe, 'default');
    if (b.ended) return { o, v: evaluate(b, side) };
    const next = decide(b, side, { ...ctx, depth: 1, rng: () => 0.5 });
    sims += next.sims + 1;
    return { o, v: next.value };
  });
  const ok = scored.filter((x) => !Number.isNaN(x.v)).sort((a, b) => b.v - a.v);
  if (!ok.length) return { choice: 'default', label: 'Automático', strategy: [], predicted: [], value: 0, sims, ms: performance.now() - t0 };
  const best = ok[0]!;
  return {
    choice: best.o.choice,
    label: best.o.label,
    strategy: ok.map((x, i) => ({ ...x.o, prob: i === 0 ? 1 : 0, value: x.v })),
    predicted: [],
    value: best.v,
    sims,
    ms: performance.now() - t0,
  };
}

/** How good was the human's actual choice? Value vs the bot's mix, compared with the best reply found. */
export function gradeChoice(battle: Battle, human: SideID, choice: string, botMix: { choice: string; prob: number }[], ctx: Pick<BotContext, 'guesses'>, alternatives = 10): { yours: number; best: number; bestLabel: string } {
  const bot = foeOf(human);
  const base = restore(serialize(battle));
  maskFoe(base, bot, ctx.guesses); // grade with the same information the bot had
  const json = serialize(base);
  const mix = botMix.filter((m) => m.prob > 0.02);
  const valueOf = (c: string) => {
    let s = 0;
    for (const m of mix) {
      const v = simulate(json, human, c, m.choice, SEEDS[0]!);
      if (Number.isNaN(v)) return NaN;
      s += v * m.prob;
    }
    return s;
  };
  const yours = valueOf(choice);
  let best = yours;
  let bestLabel = '';
  const opts = joint(slotOptions(battle, human));
  for (const o of opts.length > alternatives * 4 ? sample(opts, alternatives * 4, Math.random) : opts) {
    const v = valueOf(o.choice);
    if (!Number.isNaN(v) && v > best + 1e-9) {
      best = v;
      bestLabel = o.label;
    }
  }
  return { yours, best, bestLabel };
}

/** Keep the top-k, but always include a Protect line if one exists (it is the main mixed-strategy tool). */
const PROTECT_RE = /Protect|Detect|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark|Obstruct/;
function withProtect(ranked: Option[], k: number): Option[] {
  const top = ranked.slice(0, k);
  const prot = ranked.find((o) => PROTECT_RE.test(o.label));
  if (prot && !top.includes(prot)) top[top.length - 1] = prot;
  return top;
}

function sample<T>(arr: T[], n: number, rng: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a.slice(0, n);
}
