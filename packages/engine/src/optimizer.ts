import { dex, learnableMoves, getSpecies, toID } from './data/dex.js';
import { finalSpeed } from './damage.js';
import { validateBuild, megaFormeOf } from './legality.js';
import { scoreVsMeta, type MetaSet } from './metaset.js';
import { STAT_IDS, totalSp, type Build, type StatTable } from './build.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';
import type { StatID } from '@smogon/calc';

/**
 * Build Optimizer: critical evaluation of one build against the metagame sample.
 * Objective J = mean 1v1 index + 0.35 × mean worst case (usage-weighted). Every recommendation
 * is a measured delta of J, i.e. an opportunity cost, not a popularity argument.
 * What J cannot see (status moves, Leftovers/Sitrus recovery, team synergy) is reported as such.
 */

export interface Delta {
  label: string;
  value: string;
  delta: number;
  note?: string;
}

export interface OptimizerResult {
  base: { score: number; worst: number; objective: number };
  rows: { species: string; weight: number; score: number; worst: number }[];
  moves: { move: string; status: boolean; delta: number; note: string }[]; // value of each current move (J with − J without)
  moveSwaps: Delta[];
  items: Delta[];
  alignments: Delta[];
  spread: { sp: StatTable; delta: number; steps: string[] } | null;
  speed: { speed: number; outspeeds: string[]; outspedBy: string[]; wastedSp: number; note: string };
  verdict: string[];
  limitations: string[];
  evaluations: number;
  elapsedMs: number;
}

const W_WORST = 0.35;
const STATUS_NOTE = 'Movimiento de estado: su valor (apoyo, control) no lo mide el índice 1v1; no se recomienda quitarlo solo por este número.';
const RESIDUAL_ITEMS = new Set(['leftovers', 'sitrusberry', 'blacksludge', 'shellbell', 'rockyhelmet', 'lumberry', 'focussash', 'mentalherb', 'whiteherb', 'redcard', 'ejectbutton', 'covertcloak', 'safetygoggles', 'clearamulet']);

export async function optimizeBuild(build: Build, meta: MetaSet, reg: Regulation, format: FormatId, opts: { teamItems?: string[]; budgetEvals?: number } = {}): Promise<OptimizerResult> {
  const t0 = performance.now();
  const aopts = { format };
  let evals = 0;
  const J = (b: Build) => {
    evals++;
    const r = scoreVsMeta(b, meta, reg, aopts);
    return { ...r, objective: r.score + W_WORST * r.worst };
  };
  const base = J(build);
  const limitations = [
    'Objetivo J = índice 1v1 medio + 0,35 × peor caso, ponderado por uso en el meta (muestra del top). No es probabilidad de victoria.',
    'No mide recuperación (Restos, Baya Zidra), estados, apoyo ni sinergia con el equipo: esos efectos se señalan aparte.',
  ];

  // ---- value of each current move (opportunity cost)
  const moves = build.moves.map((m) => {
    const mv = dex.moves.get(m);
    const status = mv.category === 'Status';
    if (status) return { move: mv.name, status, delta: 0, note: STATUS_NOTE };
    const without = J({ ...build, moves: build.moves.filter((x) => x !== m) });
    const delta = base.objective - without.objective;
    return { move: mv.name, status, delta, note: delta < 0.005 ? 'Casi no aporta frente al meta: otro movimiento lo cubre.' : '' };
  });

  // ---- replacement for the weakest damaging slot
  const learn = [...(await learnableMoves(build.species))].map((id) => dex.moves.get(id)).filter((m) => m.exists && m.category !== 'Status' && reg.isMoveAllowed(m.name) && !build.moves.some((x) => toID(x) === m.id));
  const species = getSpecies(megaFormeOf(build) ?? build.species)!;
  const physical = build.sp.atk + (dex.natures.get(build.alignment).plus === 'atk' ? 8 : 0) >= build.sp.spa + (dex.natures.get(build.alignment).plus === 'spa' ? 8 : 0);
  const prefCat = physical ? 'Physical' : 'Special';
  const rank = (m: (typeof learn)[number]) => (m.basePower || 0) * (m.accuracy === true ? 1 : m.accuracy / 100) * (species.types.includes(m.type) ? 1.5 : 1) * (m.category === prefCat ? 1 : 0.45) * (m.flags.charge || m.flags.recharge ? 0.4 : 1);
  // diversify by type: best 2 per type, top 18 overall
  const byType = new Map<string, typeof learn>();
  for (const m of learn.sort((a, b) => rank(b) - rank(a))) {
    const l = byType.get(m.type) ?? [];
    if (l.length < 2) byType.set(m.type, [...l, m]);
  }
  const pool = [...byType.values()].flat().sort((a, b) => rank(b) - rank(a)).slice(0, 18);
  const weakest = moves.filter((m) => !m.status).sort((a, b) => a.delta - b.delta)[0];
  const moveSwaps: Delta[] = [];
  const slotToReplace = weakest?.move ?? (build.moves.length < 4 ? undefined : undefined);
  if (slotToReplace || build.moves.length < 4) {
    for (const m of pool) {
      const nm = slotToReplace ? build.moves.map((x) => (toID(x) === toID(slotToReplace) ? m.name : x)) : [...build.moves, m.name];
      const r = J({ ...build, moves: nm });
      const d = r.objective - base.objective;
      if (d > 0.002) moveSwaps.push({ label: slotToReplace ? `${slotToReplace} → ${m.name}` : `+ ${m.name}`, value: m.name, delta: d });
    }
    moveSwaps.sort((a, b) => b.delta - a.delta).splice(5);
  }

  // ---- items (only those whose effect J can measure are compared numerically)
  const itemCandidates = ['Life Orb', 'Choice Scarf', 'Expert Belt', 'Focus Sash', 'Leftovers', 'Sitrus Berry', 'Black Glasses', 'Charcoal', 'Mystic Water', 'Miracle Seed', 'Magnet', 'Never-Melt Ice', 'Black Belt', 'Poison Barb', 'Soft Sand', 'Sharp Beak', 'Twisted Spoon', 'Silver Powder', 'Hard Stone', 'Spell Tag', 'Dragon Fang', 'Metal Coat', 'Fairy Feather', 'Silk Scarf', 'Muscle Band', 'Wise Glasses', 'Scope Lens', 'Rocky Helmet'];
  const mega = megaFormeOf(build);
  const items: Delta[] = [];
  if (!mega) {
    for (const it of itemCandidates) {
      if (!reg.isItemAllowed(it) || toID(it) === toID(build.item ?? '')) continue;
      const r = J({ ...build, item: it });
      const d = r.objective - base.objective;
      const used = opts.teamItems?.some((x) => toID(x) === toID(it));
      items.push({ label: it, value: it, delta: d, note: [RESIDUAL_ITEMS.has(toID(it)) ? 'efecto residual/defensivo no medido' : '', used ? 'ya lo lleva otro miembro (Item Clause)' : ''].filter(Boolean).join(' · ') || undefined });
    }
    items.sort((a, b) => b.delta - a.delta).splice(6);
  }

  // ---- alignment (nature)
  const alignments: Delta[] = [];
  for (const n of dex.natures.all()) {
    if (n.name === build.alignment || (n.plus && n.plus === n.minus && n.name !== 'Serious')) continue;
    const r = J({ ...build, alignment: n.name });
    const d = r.objective - base.objective;
    if (d > 0.002) alignments.push({ label: n.name, value: n.name, delta: d, note: n.plus ? `+${n.plus} −${n.minus}` : 'neutra' });
  }
  alignments.sort((a, b) => b.delta - a.delta).splice(3);

  // ---- Stat Points: first-improvement hill climbing over point transfers (budget-limited)
  const cap = reg.pack.statPoints.perStatMax.value;
  const total = reg.pack.statPoints.total.value;
  const budget = opts.budgetEvals ?? 70;
  let cur = { ...build.sp };
  // spend unspent points first, greedily
  let curJ = base.objective;
  const steps: string[] = [];
  const tryMove = (from: StatID | null, to: StatID, k: number) => {
    const sp = { ...cur };
    if (from) {
      if (sp[from] < k) return null;
      sp[from] -= k;
    } else if (totalSp(sp) + k > total) return null;
    if (sp[to] + k > cap) return null;
    sp[to] += k;
    return sp;
  };
  let spread: OptimizerResult['spread'] = null;
  for (const k of [8, 4, 2]) {
    let improved = true;
    while (improved && evals < budget + 40) {
      improved = false;
      const sources: (StatID | null)[] = totalSp(cur) < total ? [null] : STAT_IDS.filter((s) => cur[s] >= k);
      outer: for (const from of sources) {
        for (const to of STAT_IDS) {
          if (from === to) continue;
          const sp = tryMove(from, to, k);
          if (!sp) continue;
          const r = J({ ...build, sp });
          if (r.objective > curJ + 0.003) {
            steps.push(`${from ? `${k} SP ${from} → ${to}` : `+${k} SP en ${to}`} (+${(r.objective - curJ).toFixed(3)})`);
            cur = sp;
            curJ = r.objective;
            improved = true;
            break outer;
          }
          if (evals >= budget + 40) break outer;
        }
      }
    }
  }
  if (curJ > base.objective + 0.003) spread = { sp: cur, delta: curJ - base.objective, steps };

  // ---- speed benchmarks vs the meta sample's likely sets
  const mySpeed = finalSpeed(build, reg);
  const outspeeds: string[] = [];
  const outspedBy: string[] = [];
  let neededSpeed = 0;
  for (const m of meta.models) {
    const top = m.candidates[0];
    if (!top) continue;
    const s = finalSpeed(top.build, reg);
    const label = `${m.species} (${s})`;
    if (mySpeed > s) {
      outspeeds.push(label);
      neededSpeed = Math.max(neededSpeed, s + 1);
    } else outspedBy.push(label);
  }
  let wastedSp = 0;
  for (let sp = build.sp.spe - 1; sp >= 0; sp--) {
    if (finalSpeed({ ...build, sp: { ...build.sp, spe: sp } }, reg) >= neededSpeed) wastedSp = build.sp.spe - sp;
    else break;
  }
  const speed = {
    speed: mySpeed,
    outspeeds,
    outspedBy,
    wastedSp,
    note: wastedSp > 0 ? `Con ${build.sp.spe - wastedSp} SP en Velocidad sigues superando a los mismos rivales del top: ${wastedSp} SP podrían ir a bulk.` : 'Cada punto de Velocidad cambia a quién superas en el top del meta.',
  };

  // ---- verdict
  const verdict: string[] = [];
  const legal = (await validateBuild(build, reg)).filter((i) => i.severity === 'error');
  if (legal.length) verdict.push(`⚠ La build no es legal: ${legal[0]!.message}.`);
  verdict.push(`Índice medio contra el meta: ${base.score.toFixed(2)} (peor caso ${base.worst.toFixed(2)}).`);
  const weak = moves.filter((m) => !m.status && m.delta < 0.005);
  if (weak.length) verdict.push(`${weak.map((m) => m.move).join(', ')}: casi no aporta${weak.length > 1 ? 'n' : ''} frente al meta.`);
  if (moveSwaps[0]) verdict.push(`Mejor cambio de movimiento: ${moveSwaps[0].label} (+${moveSwaps[0].delta.toFixed(3)}).`);
  const bestItem = items.find((i) => !i.note?.includes('Item Clause'));
  if (bestItem && bestItem.delta > 0.01) verdict.push(`Objeto: ${bestItem.label} mejoraría J en +${bestItem.delta.toFixed(3)}${bestItem.note ? ` (${bestItem.note})` : ''}.`);
  if (spread) verdict.push(`Stat Points: una redistribución mejora J en +${spread.delta.toFixed(3)}.`);
  if (!moveSwaps.length && !spread && !(bestItem && bestItem.delta > 0.01) && !alignments.length) verdict.push('No se encontró una mejora medible: la build ya es localmente óptima para este objetivo.');
  if (wastedSp > 0) verdict.push(speed.note);

  return {
    base: { score: base.score, worst: base.worst, objective: base.objective },
    rows: base.rows.sort((a, b) => a.score - b.score),
    moves,
    moveSwaps,
    items,
    alignments,
    spread,
    speed,
    verdict,
    limitations,
    evaluations: evals,
    elapsedMs: performance.now() - t0,
  };
}
