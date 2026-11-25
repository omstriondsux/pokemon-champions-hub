import { getSpecies } from './data/dex.js';
import { opponentModel } from './opponent.js';
import { evaluatePair } from './advisor.js';
import { buildSquads, type PoolEntry } from './squad.js';
import type { MetaSet } from './metaset.js';
import type { MetaSnapshot } from './meta.js';
import type { Build } from './build.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';

/**
 * Recruitment Advisor: which of the offered Pokémon to take.
 * - Individual value: how its most common meta build fares against the meta (1v1 index, usage-weighted).
 * - Value FOR YOUR INVENTORY: best squad score with the candidate added minus without it (marginal value),
 *   plus which of your currently unanswered meta threats it answers.
 * Ranking uses the inventory value when you have ≥ 4 usable builds; otherwise the individual value.
 */
export interface RecruitCandidate {
  species: string;
  build?: Build; // defaults to its most common meta build
  cost?: number | null; // VP or any unit the user enters
}

export interface RecruitRow {
  species: string;
  build: Build;
  buildSource: string;
  usage: number;
  individual: number;
  marginal: number | null;
  /** Which team terms change when it joins your best team (explains the marginal value). */
  drivers: string[];
  answersUncovered: string[];
  redundantWith: string[];
  cost: number | null;
  valuePerCost: number | null;
  rank: number;
  reasons: string[];
}

export interface RecruitResult {
  rows: RecruitRow[];
  verdict: string[];
  basis: 'inventory' | 'individual';
  limitations: string[];
  elapsedMs: number;
}

const MEDIOCRE_INDIVIDUAL = 0.05;
const TERM_ES: Record<string, string> = { coverage: 'cobertura', consistency: 'consistencia', depth: 'profundidad', offense: 'ofensiva', speed: 'control de velocidad', support: 'apoyo', weakness: 'debilidades compartidas', favorites: 'favoritos', cost: 'coste' };
const MEDIOCRE_MARGINAL = 0.004;

export async function adviseRecruitment(
  candidates: RecruitCandidate[],
  pool: PoolEntry[],
  meta: MetaSet,
  snapshot: MetaSnapshot | undefined,
  reg: Regulation,
  format: FormatId,
): Promise<RecruitResult> {
  const t0 = performance.now();
  const aopts = { format };
  const usable = pool.length >= 4;
  const baseSquad = usable ? buildSquads(pool, meta, reg, format, 'balanced', { beam: 12, results: 1 }) : undefined;
  const baseScore = baseSquad?.teams[0]?.score ?? 0;
  const uncovered = new Set(baseSquad?.teams[0]?.uncovered.map((u) => u.species) ?? []);
  const ownedTypes = pool.map((p) => ({ label: p.label, types: (getSpecies(p.build.species)?.types ?? []) as string[] }));

  const rows: RecruitRow[] = [];
  for (const c of candidates) {
    const model = await opponentModel(c.species, snapshot);
    const build = c.build ?? model.candidates[0]!.build;
    const buildSource = c.build ? 'tu build' : model.source === 'meta' ? `build más común del meta (${model.candidates[0]!.label.split(' · ').slice(1).join(' · ')})` : 'build hipotética (sin datos)';
    const scores = meta.models.map((m) => evaluatePair(build, m, reg, aopts).score);
    const individual = scores.reduce((s, x, i) => s + x * meta.weights[i]!, 0);
    const answersUncovered = meta.models.filter((m, i) => uncovered.has(m.species) && scores[i]! >= 0.25).map((m) => m.species);
    let marginal: number | null = null;
    let drivers: string[] = [];
    if (usable) {
      const entry: PoolEntry = { id: `cand:${c.species}`, ownerId: `cand:${c.species}`, label: c.species, build };
      const with_ = buildSquads([...pool, entry], meta, reg, format, 'balanced', { beam: 12, results: 1 });
      marginal = (with_.teams[0]?.score ?? baseScore) - baseScore;
      const tw = with_.teams[0];
      const tb = baseSquad?.teams[0];
      if (tw && tb) {
        const inTeam = tw.members.includes(pool.length);
        drivers = inTeam
          ? (Object.keys(tw.terms) as (keyof typeof tw.terms)[])
              .map((k) => ({ k, d: tw.terms[k] - tb.terms[k] }))
              .filter((x) => Math.abs(x.d) > 0.01)
              .sort((a, b) => b.d - a.d)
              .map((x) => `${TERM_ES[x.k] ?? x.k} ${x.d > 0 ? '+' : ''}${x.d.toFixed(2)}`)
          : ['no entra en tu mejor equipo'];
      }
    }
    const types: string[] = getSpecies(build.species)?.types ?? [];
    const redundantWith = ownedTypes.filter((o) => o.types.length && o.types.every((t) => types.includes(t))).map((o) => o.label);
    const cost = c.cost ?? null;
    const key = marginal ?? individual;
    rows.push({ species: c.species, build, buildSource, usage: model.usage, individual, marginal, drivers, answersUncovered, redundantWith, cost, valuePerCost: cost && cost > 0 ? key / cost : null, rank: 0, reasons: [] });
  }

  rows.sort((a, b) => (usable ? b.marginal! - a.marginal! || b.individual - a.individual : b.individual - a.individual));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    r.reasons.push(`Rendimiento individual contra el meta: ${r.individual.toFixed(2)}${r.usage ? ` · uso ${(r.usage * 100).toFixed(1)}%` : ''}.`);
    if (r.marginal !== null) r.reasons.push(`Mejora de tu mejor equipo posible: ${r.marginal >= 0 ? '+' : ''}${r.marginal.toFixed(3)}${r.drivers.length ? ` (${r.drivers.join(', ')})` : ''}.`);
    if (r.answersUncovered.length) r.reasons.push(`Responde a amenazas que hoy no cubres: ${r.answersUncovered.join(', ')}.`);
    if (r.redundantWith.length) r.reasons.push(`Redundante en tipos con: ${r.redundantWith.join(', ')}.`);
  });

  const verdict: string[] = [];
  const best = rows[0];
  if (best) {
    const bestIndividual = [...rows].sort((a, b) => b.individual - a.individual)[0]!;
    if (usable && bestIndividual.species !== best.species) {
      verdict.push(`${bestIndividual.species} es el mejor individualmente, pero ${best.species} aporta más a TU inventario (${best.marginal! >= 0 ? '+' : ''}${best.marginal!.toFixed(3)} frente a ${bestIndividual.marginal! >= 0 ? '+' : ''}${bestIndividual.marginal!.toFixed(3)}).`);
    } else verdict.push(`Recomendación: ${best.species}.`);
    const allMediocre = rows.every((r) => r.individual < MEDIOCRE_INDIVIDUAL && (r.marginal === null || r.marginal < MEDIOCRE_MARGINAL));
    if (allMediocre) verdict.push('Todas las opciones son mediocres frente al meta actual y apenas mejoran tu equipo: si el juego lo permite, conviene esperar o guardar recursos.');
    else if (usable && best.marginal! < MEDIOCRE_MARGINAL) verdict.push('Ninguna opción mejora de forma apreciable tu mejor equipo: elige por preferencia o espera a una oferta mejor.');
  }
  return {
    rows,
    verdict,
    basis: usable ? 'inventory' : 'individual',
    limitations: [
      usable ? 'Valor para tu inventario = mejora del mejor equipo «equilibrado» que el Squad Builder puede formar.' : 'Tienes menos de 4 builds utilizables: se compara solo el rendimiento individual.',
      'El potencial futuro no se predice: solo se usa el meta actual.',
    ],
    elapsedMs: performance.now() - t0,
  };
}
