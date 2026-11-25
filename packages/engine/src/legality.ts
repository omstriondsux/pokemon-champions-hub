import { canLearn, dex, getSpecies, toID } from './data/dex.js';
import { validateSpread } from './stats.js';
import type { Build } from './build.js';
import type { Regulation } from './rules/regulation.js';
import type { FormatId } from './rules/schema.js';

export type Severity = 'error' | 'warning';
export interface LegalityIssue {
  severity: Severity;
  code: string;
  message: string;
  /** Rule confidence from the pack: warnings derived from "assumed" rules must say so. */
  ruleConfidence?: string;
}

/** Mega forme the build turns into with its held item, if any. */
export function megaFormeOf(build: Build): string | undefined {
  if (!build.item) return undefined;
  const item = dex.items.get(build.item);
  const species = getSpecies(build.species);
  if (!item.exists || !species) return undefined;
  const ms = item.megaStone as unknown;
  if (typeof ms === 'string') return ms;
  if (ms && typeof ms === 'object') return (ms as Record<string, string>)[species.name];
  return undefined;
}

export async function validateBuild(build: Build, reg: Regulation): Promise<LegalityIssue[]> {
  const issues: LegalityIssue[] = [];
  const err = (code: string, message: string) => issues.push({ severity: 'error', code, message });

  const species = getSpecies(build.species);
  if (!species) {
    err('species-unknown', `Unknown species "${build.species}"`);
    return issues;
  }
  if (species.battleOnly || species.isMega) {
    err('species-battle-only', `${species.name} is a battle-only forme; register ${species.baseSpecies} with its Mega Stone`);
  }
  if (!reg.isSpeciesAllowed(species.name)) {
    err('species-not-allowed', `${species.name} is not allowed in ${reg.id}`);
  }

  // Ability
  const abilities = Object.values(species.abilities).map(toID);
  if (!abilities.includes(toID(build.ability))) {
    err('ability-not-available', `${species.name} cannot have ${build.ability} (options: ${Object.values(species.abilities).join(', ')})`);
  } else if (!reg.isAbilityAllowed(build.ability)) {
    err('ability-banned', `${build.ability} is banned in ${reg.id}`);
  }

  // Item
  if (build.item) {
    const item = dex.items.get(build.item);
    if (!item.exists) err('item-unknown', `Unknown item "${build.item}"`);
    else if (!reg.isItemAllowed(item.name)) err('item-not-allowed', `${item.name} is not available in ${reg.id}`);
    if (item.exists && item.megaStone) {
      const forme = megaFormeOf(build);
      if (!forme) err('mega-stone-mismatch', `${item.name} does not work on ${species.name}`);
      else if (!reg.pack.mechanics.value.mega) err('mega-disabled', `Mega Evolution is disabled in ${reg.id}`);
      else if (forme.endsWith('-Z') && !reg.pack.mechanics.value.zMega) err('zmega-disabled', `Z-Mega Evolution is disabled in ${reg.id}`);
      else if (!reg.isSpeciesAllowed(forme)) err('mega-not-allowed', `${forme} is not allowed in ${reg.id}`);
    }
  }

  // Alignment
  if (!dex.natures.get(build.alignment).exists) err('alignment-unknown', `Unknown Stat Alignment "${build.alignment}"`);

  // Moves
  if (build.moves.length < 1 || build.moves.length > 4) err('moves-count', `A build needs 1-4 moves (has ${build.moves.length})`);
  const seen = new Set<string>();
  for (const m of build.moves) {
    const move = dex.moves.get(m);
    if (!move.exists) {
      err('move-unknown', `Unknown move "${m}"`);
      continue;
    }
    if (seen.has(move.id)) err('move-duplicate', `${move.name} appears twice`);
    seen.add(move.id);
    if (!reg.isMoveAllowed(move.name)) err('move-not-allowed', `${move.name} is not available in ${reg.id}`);
    else if (!(await canLearn(species.name, move.name))) err('move-not-learnable', `${species.name} cannot learn ${move.name}`);
  }
  if (build.moves.length < 4) {
    issues.push({ severity: 'warning', code: 'moves-incomplete', message: `Only ${build.moves.length} moves: empty slots are wasted value` });
  }

  // Stat Points
  const sp = reg.pack.statPoints;
  for (const s of validateSpread(build.sp, { total: sp.total.value, perStatMax: sp.perStatMax.value })) err(s.code, s.message);
  const used = Object.values(build.sp).reduce((a, b) => a + b, 0);
  if (used < sp.total.value) {
    issues.push({ severity: 'warning', code: 'sp-unspent', message: `${sp.total.value - used} Stat Points unspent` });
  }
  return issues;
}

export interface TeamIssue extends LegalityIssue {
  members?: number[];
}

/** Validate a registered team (the 3-6 / 4-6 you take into matchmaking). */
export async function validateTeam(team: Build[], reg: Regulation, format: FormatId): Promise<TeamIssue[]> {
  const rules = reg.format(format);
  const issues: TeamIssue[] = [];
  const { min, max } = rules.teamSize.value;
  if (team.length < min || team.length > max) {
    issues.push({ severity: 'error', code: 'team-size', message: `Team must have ${min}-${max} Pokémon (has ${team.length})`, ruleConfidence: rules.teamSize.confidence });
  }

  const clauses = rules.clauses.value;
  const conf = rules.clauses.confidence;
  if (clauses.includes('species')) {
    const byNum = new Map<number, number[]>();
    team.forEach((b, i) => {
      const s = getSpecies(b.species);
      if (s) byNum.set(s.num, [...(byNum.get(s.num) ?? []), i]);
    });
    for (const [, idx] of byNum) {
      if (idx.length > 1) issues.push({ severity: 'error', code: 'species-clause', message: `Species Clause: ${team[idx[0]!]!.species} appears ${idx.length} times`, members: idx, ruleConfidence: conf });
    }
  }
  if (clauses.includes('item')) {
    const byItem = new Map<string, number[]>();
    team.forEach((b, i) => {
      if (b.item) byItem.set(toID(b.item), [...(byItem.get(toID(b.item)) ?? []), i]);
    });
    for (const [, idx] of byItem) {
      if (idx.length > 1) issues.push({ severity: 'error', code: 'item-clause', message: `Item Clause: ${team[idx[0]!]!.item} appears ${idx.length} times`, members: idx, ruleConfidence: conf });
    }
  }

  const megas = team.map((b, i) => (megaFormeOf(b) ? i : -1)).filter((i) => i >= 0);
  const perBattle = reg.pack.mechanics.value.megaPerBattle;
  if (megas.length > perBattle) {
    issues.push({ severity: 'warning', code: 'multiple-megas', message: `${megas.length} Mega Stones on the team but only ${perBattle} can Mega Evolve per battle`, members: megas });
  }

  for (const [i, b] of team.entries()) {
    for (const issue of await validateBuild(b, reg)) issues.push({ ...issue, members: [i] });
  }
  return issues;
}

/**
 * Selection made at team preview from the registered team.
 * Hard rule from the spec: never recommend a Pokémon that is not in the registered team.
 */
export function validateSelection(team: Build[], selected: number[], reg: Regulation, format: FormatId): LegalityIssue[] {
  const bring = reg.format(format).bring;
  const issues: LegalityIssue[] = [];
  if (new Set(selected).size !== selected.length) issues.push({ severity: 'error', code: 'selection-duplicate', message: 'The same Pokémon is selected twice' });
  if (selected.some((i) => i < 0 || i >= team.length)) issues.push({ severity: 'error', code: 'selection-not-in-team', message: 'Selection includes a Pokémon outside the registered team' });
  if (selected.length !== bring.value) issues.push({ severity: 'error', code: 'selection-size', message: `Must bring exactly ${bring.value}`, ruleConfidence: bring.confidence });
  return issues;
}
