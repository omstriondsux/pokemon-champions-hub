import { database, toID } from '../data/dex.js';
import { RegulationPack, type FormatId, type FormatRules } from './schema.js';

export class Regulation {
  readonly pack: RegulationPack;
  private readonly rosterDeny: Set<string>;
  private readonly rosterAllow?: Set<string>;
  private readonly itemDeny: Set<string>;
  private readonly itemAllow?: Set<string>;
  private readonly moveDeny: Set<string>;
  private readonly abilityDeny: Set<string>;

  constructor(raw: unknown) {
    this.pack = RegulationPack.parse(raw);
    const r = this.pack.roster.value;
    const i = this.pack.items.value;
    if (r.mode === 'explicit' && !r.allow) throw new Error(`${this.pack.id}: roster mode "explicit" requires "allow"`);
    if (i.mode === 'explicit' && !i.allow) throw new Error(`${this.pack.id}: items mode "explicit" requires "allow"`);
    this.rosterDeny = new Set(r.deny.map(toID));
    this.rosterAllow = r.allow ? new Set(r.allow.map(toID)) : undefined;
    this.itemDeny = new Set(i.deny.map(toID));
    this.itemAllow = i.allow ? new Set(i.allow.map(toID)) : undefined;
    this.moveDeny = new Set(this.pack.moves.value.deny.map(toID));
    this.abilityDeny = new Set(this.pack.abilities.value.deny.map(toID));
  }

  get id() {
    return this.pack.id;
  }

  format(id: FormatId): FormatRules {
    return this.pack.formats[id];
  }

  isSpeciesAllowed(name: string): boolean {
    const id = toID(name);
    if (this.rosterDeny.has(id)) return false;
    if (this.rosterAllow) return this.rosterAllow.has(id);
    return database.hasSpecies(name);
  }

  isItemAllowed(name: string): boolean {
    const id = toID(name);
    if (this.itemDeny.has(id)) return false;
    if (this.itemAllow) return this.itemAllow.has(id);
    return database.hasItem(name);
  }

  isMoveAllowed(name: string): boolean {
    return !this.moveDeny.has(toID(name)) && database.hasMove(name);
  }

  isAbilityAllowed(name: string): boolean {
    return !this.abilityDeny.has(toID(name));
  }

  /** Expected additions that are missing from the database: a non-empty list means the data is stale. */
  missingExpectedAdditions(): { species: string[]; items: string[] } {
    return {
      species: this.pack.roster.value.expectedAdditions.filter((s) => !this.isSpeciesAllowed(s)),
      items: this.pack.items.value.expectedAdditions.filter((s) => !this.isItemAllowed(s)),
    };
  }

  /** Is `date` (YYYY-MM-DD) inside this regulation's window? */
  isActiveOn(date: string): boolean {
    return date >= this.pack.validFrom.value && date <= this.pack.validTo.value;
  }
}

/** Pick the regulation active on `date` from a set of packs. */
export function activeRegulation(packs: Regulation[], date: string): Regulation | undefined {
  return packs
    .filter((r) => r.isActiveOn(date))
    .sort((a, b) => b.pack.validFrom.value.localeCompare(a.pack.validFrom.value))[0];
}
