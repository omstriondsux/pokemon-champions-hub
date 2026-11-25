import { canLearn, dex, getSpecies, registeredForme, toID } from './data/dex.js';
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
    err('species-unknown', `Especie desconocida: "${build.species}"`);
    return issues;
  }
  if (species.battleOnly || species.isMega) {
    err('species-battle-only', `${species.name} es una forma solo de combate: registra ${registeredForme(species.name)}`);
  }
  if (!reg.isSpeciesAllowed(species.name)) {
    err('species-not-allowed', `${species.name} no está permitido en ${reg.id}`);
  }

  // Ability
  const abilities = Object.values(species.abilities).map(toID);
  if (!abilities.includes(toID(build.ability))) {
    err('ability-not-available', `${species.name} no puede tener ${build.ability} (opciones: ${Object.values(species.abilities).join(', ')})`);
  } else if (!reg.isAbilityAllowed(build.ability)) {
    err('ability-banned', `${build.ability} está prohibida en ${reg.id}`);
  }

  // Item
  if (build.item) {
    const item = dex.items.get(build.item);
    if (!item.exists) err('item-unknown', `Objeto desconocido: "${build.item}"`);
    else if (!reg.isItemAllowed(item.name)) err('item-not-allowed', `${item.name} no está disponible en ${reg.id}`);
    if (item.exists && item.megaStone) {
      const forme = megaFormeOf(build);
      if (!forme) err('mega-stone-mismatch', `${item.name} no funciona con ${species.name}`);
      else if (!reg.pack.mechanics.value.mega) err('mega-disabled', `La megaevolución está desactivada en ${reg.id}`);
      else if (forme.endsWith('-Z') && !reg.pack.mechanics.value.zMega) err('zmega-disabled', `La megaevolución Z está desactivada en ${reg.id}`);
      else if (!reg.isSpeciesAllowed(forme)) err('mega-not-allowed', `${forme} no está permitido en ${reg.id}`);
    }
  }

  // Alignment
  if (!dex.natures.get(build.alignment).exists) err('alignment-unknown', `Alineación desconocida: "${build.alignment}"`);

  // Moves
  if (build.moves.length < 1 || build.moves.length > 4) err('moves-count', `Una build necesita de 1 a 4 movimientos (tiene ${build.moves.length})`);
  const seen = new Set<string>();
  for (const m of build.moves) {
    const move = dex.moves.get(m);
    if (!move.exists) {
      err('move-unknown', `Movimiento desconocido: "${m}"`);
      continue;
    }
    if (seen.has(move.id)) err('move-duplicate', `${move.name} está repetido`);
    seen.add(move.id);
    if (!reg.isMoveAllowed(move.name)) err('move-not-allowed', `${move.name} no está disponible en ${reg.id}`);
    else if (!(await canLearn(species.name, move.name))) err('move-not-learnable', `${species.name} no puede aprender ${move.name}`);
  }
  if (build.moves.length < 4) {
    issues.push({ severity: 'warning', code: 'moves-incomplete', message: `Solo ${build.moves.length} movimientos: los huecos vacíos son valor desperdiciado` });
  }

  // Stat Points
  const sp = reg.pack.statPoints;
  for (const s of validateSpread(build.sp, { total: sp.total.value, perStatMax: sp.perStatMax.value })) err(s.code, s.message);
  const used = Object.values(build.sp).reduce((a, b) => a + b, 0);
  if (used < sp.total.value) {
    issues.push({ severity: 'warning', code: 'sp-unspent', message: `${sp.total.value - used} Stat Points sin asignar` });
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
    issues.push({ severity: 'error', code: 'team-size', message: `El equipo debe tener de ${min} a ${max} Pokémon (tiene ${team.length})`, ruleConfidence: rules.teamSize.confidence });
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
      if (idx.length > 1) issues.push({ severity: 'error', code: 'species-clause', message: `Species Clause: ${team[idx[0]!]!.species} aparece ${idx.length} veces`, members: idx, ruleConfidence: conf });
    }
  }
  if (clauses.includes('item')) {
    const byItem = new Map<string, number[]>();
    team.forEach((b, i) => {
      if (b.item) byItem.set(toID(b.item), [...(byItem.get(toID(b.item)) ?? []), i]);
    });
    for (const [, idx] of byItem) {
      if (idx.length > 1) issues.push({ severity: 'error', code: 'item-clause', message: `Item Clause: ${team[idx[0]!]!.item} aparece ${idx.length} veces`, members: idx, ruleConfidence: conf });
    }
  }

  const megas = team.map((b, i) => (megaFormeOf(b) ? i : -1)).filter((i) => i >= 0);
  const perBattle = reg.pack.mechanics.value.megaPerBattle;
  if (megas.length > perBattle) {
    issues.push({ severity: 'warning', code: 'multiple-megas', message: `${megas.length} megapiedras en el equipo, pero solo ${perBattle} puede megaevolucionar por combate`, members: megas });
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
  if (new Set(selected).size !== selected.length) issues.push({ severity: 'error', code: 'selection-duplicate', message: 'El mismo Pokémon está seleccionado dos veces' });
  if (selected.some((i) => i < 0 || i >= team.length)) issues.push({ severity: 'error', code: 'selection-not-in-team', message: 'La selección incluye un Pokémon que no está en el equipo registrado' });
  if (selected.length !== bring.value) issues.push({ severity: 'error', code: 'selection-size', message: `Debes elegir exactamente ${bring.value}`, ruleConfidence: bring.confidence });
  return issues;
}
