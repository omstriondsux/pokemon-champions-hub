import { Dex, toID, type ID, type ModData, type Species } from '@pkmn/dex';
import * as championsMod from '@pkmn/mods/champions';
import { Generations } from '@smogon/calc';

/**
 * Two data sources, each used for what it does best:
 *  - @pkmn/mods "champions": species metadata and learnsets (legality).
 *  - @smogon/calc gen 0: the Champions roster, items and move numbers used for damage.
 * Tests cross-check that they agree on the names we rely on.
 */
export const dex = Dex.mod('champions' as ID, championsMod as unknown as ModData);
export const calcGen = Generations.get(0 as never);

export { toID };

const calcSpeciesById = new Map([...calcGen.species].map((s) => [toID(s.name), s.name]));
const calcItemsById = new Map([...calcGen.items].map((i) => [toID(i.name), i.name]));
const calcMovesById = new Map([...calcGen.moves].map((m) => [toID(m.name), m.name]));

export const database = {
  speciesIds: (): ID[] => [...calcSpeciesById.keys()] as ID[],
  itemIds: (): ID[] => [...calcItemsById.keys()] as ID[],
  hasSpecies: (name: string) => calcSpeciesById.has(toID(name)),
  hasItem: (name: string) => calcItemsById.has(toID(name)),
  hasMove: (name: string) => calcMovesById.has(toID(name)),
  /** Canonical calc name (handles "Sirfetch'd" vs "Sirfetch’d", casing, etc.). */
  speciesName: (name: string) => calcSpeciesById.get(toID(name)),
  itemName: (name: string) => calcItemsById.get(toID(name)),
  moveName: (name: string) => calcMovesById.get(toID(name)),
};

export function getSpecies(name: string): Species | undefined {
  const s = dex.species.get(name);
  return s.exists ? s : undefined;
}

/** Species whose learnset applies to `species`: itself, its base forme, and its pre-evolutions. */
function learnsetChain(species: Species): Species[] {
  const chain: Species[] = [];
  const seen = new Set<string>();
  let cur: Species | undefined = species;
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    const formeSource: string | undefined = cur.changesFrom ?? (cur.baseSpecies !== cur.name ? cur.baseSpecies : undefined);
    if (formeSource) {
      const base = getSpecies(formeSource);
      if (base && !seen.has(base.id)) {
        chain.push(base);
        seen.add(base.id);
        cur = base.prevo ? getSpecies(base.prevo) : undefined;
        continue;
      }
    }
    cur = cur.prevo ? getSpecies(cur.prevo) : undefined;
  }
  return chain;
}

const learnableCache = new Map<string, Set<ID>>();

export async function learnableMoves(speciesName: string): Promise<Set<ID>> {
  const species = getSpecies(speciesName);
  if (!species) return new Set();
  const cached = learnableCache.get(species.id);
  if (cached) return cached;
  const out = new Set<ID>();
  for (const s of learnsetChain(species)) {
    const ls = await dex.learnsets.get(s.id);
    for (const move of Object.keys(ls.learnset ?? {})) out.add(move as ID);
  }
  learnableCache.set(species.id, out);
  return out;
}

export async function canLearn(speciesName: string, moveName: string): Promise<boolean> {
  return (await learnableMoves(speciesName)).has(toID(moveName));
}
