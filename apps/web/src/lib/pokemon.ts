import { database, dex, getSpecies, toID } from '@pch/engine';
import type { OwnedPokemon, Team } from './types';
import type { Build } from '@pch/engine';

export const TYPE_COLORS: Record<string, string> = {
  Normal: '#9fa19f', Fire: '#e62829', Water: '#2980ef', Electric: '#fac000', Grass: '#3fa129', Ice: '#3dcef3',
  Fighting: '#ff8000', Poison: '#9141cb', Ground: '#915121', Flying: '#81b9ef', Psychic: '#ef4179', Bug: '#91a119',
  Rock: '#afa981', Ghost: '#704170', Dragon: '#5060e1', Dark: '#624d4e', Steel: '#60a1b8', Fairy: '#ef70ef',
};

/** Showdown sprite id: base + "-" + forme ("charizard-megay"). */
export function spriteId(name: string): string {
  const s = getSpecies(name);
  if (!s) return toID(name);
  return s.forme ? `${toID(s.baseSpecies)}-${toID(s.forme)}` : toID(s.name);
}
export const spriteUrl = (name: string, kind: 'home' | 'icon' = 'home') =>
  `https://play.pokemonshowdown.com/sprites/${kind === 'home' ? 'home-centered' : 'gen5'}/${spriteId(name)}.png`;
export const itemIconUrl = (item: string) => `https://play.pokemonshowdown.com/sprites/itemicons/${item.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '')}.png`;

/** Species a player can register/pick at preview: Champions roster minus battle-only formes. */
let previewSpeciesCache: string[] | undefined;
export function previewSpecies(): string[] {
  if (previewSpeciesCache) return previewSpeciesCache;
  previewSpeciesCache = database
    .speciesIds()
    .map((id) => getSpecies(id))
    .filter((s): s is NonNullable<typeof s> => !!s && !s.isMega && !s.battleOnly)
    .map((s) => s.name)
    .sort();
  return previewSpeciesCache;
}

export const ALIGNMENTS = dex.natures.all().map((n) => n.name).sort();
export const allItems = () => database.itemIds().map((id) => database.itemName(id)!).sort();

export function resolveTeam(team: Team | undefined, pokemon: OwnedPokemon[]): { builds: Build[]; missing: number } {
  if (!team) return { builds: [], missing: 0 };
  let missing = 0;
  const builds: Build[] = [];
  for (const m of team.members) {
    const p = pokemon.find((x) => x.id === m.pokemonId);
    const b = p?.builds.find((x) => x.id === m.buildId);
    if (b) builds.push(b.build);
    else missing++;
  }
  return { builds, missing };
}

export const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;
