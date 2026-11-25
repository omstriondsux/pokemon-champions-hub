import { dex, getSpecies } from './data/dex.js';
import { STAT_IDS, zeroStats, type Build, type StatTable } from './build.js';
import type { StatID } from '@smogon/calc';

/**
 * Champions stat formula (level 50, IV 31 fixed, 1 SP = +1 stat):
 *   HP    = base + SP + 75
 *   Other = floor(alignmentMod * (base + SP + 20))
 * Equivalent to the classic formula at Lv50 / 31 IV with 8 EVs per SP.
 * Cross-checked against @smogon/calc in tests.
 */
export function statValue(stat: StatID, base: number, sp: number, alignment?: string): number {
  if (stat === 'hp') return base === 1 ? 1 : base + sp + 75;
  return Math.floor(alignmentMultiplier(stat, alignment) * (base + sp + 20));
}

export function alignmentMultiplier(stat: StatID, alignment?: string): number {
  if (!alignment) return 1;
  const n = dex.natures.get(alignment);
  if (!n.exists || n.plus === n.minus) return 1;
  if (n.plus === stat) return 1.1;
  if (n.minus === stat) return 0.9;
  return 1;
}

/** Stat as a function of the species name (forme-aware: pass "Garchomp-Mega" for mega stats). */
export function finalStats(speciesName: string, sp: StatTable, alignment?: string): StatTable {
  const species = getSpecies(speciesName);
  if (!species) throw new Error(`Unknown species: ${speciesName}`);
  const out = zeroStats();
  for (const s of STAT_IDS) out[s] = statValue(s, species.baseStats[s], sp[s], alignment);
  return out;
}

export const buildStats = (b: Build, forme = b.species) => finalStats(forme, b.sp, b.alignment);

export interface SpreadIssue {
  code: 'sp-total' | 'sp-per-stat' | 'sp-negative' | 'sp-not-integer';
  message: string;
}

export function validateSpread(sp: StatTable, limits: { total: number; perStatMax: number }): SpreadIssue[] {
  const issues: SpreadIssue[] = [];
  let sum = 0;
  for (const s of STAT_IDS) {
    const v = sp[s];
    sum += v;
    if (!Number.isInteger(v)) issues.push({ code: 'sp-not-integer', message: `${s}: ${v} no es un entero` });
    if (v < 0) issues.push({ code: 'sp-negative', message: `${s}: ${v} < 0` });
    if (v > limits.perStatMax) issues.push({ code: 'sp-per-stat', message: `${s}: ${v} > ${limits.perStatMax}` });
  }
  if (sum > limits.total) issues.push({ code: 'sp-total', message: `total ${sum} > ${limits.total}` });
  return issues;
}
