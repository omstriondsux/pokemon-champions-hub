import { getSpecies, opponentModel, toID, type MetaSnapshot, type OpponentModel, type Regulation } from '@pch/engine';
import { previewSpecies } from './pokemon';
import type { OwnedBuild, OwnedPokemon } from './types';

/**
 * "You own every Pokémon" catalog: every species allowed in the active regulation, each with
 * ready-made builds taken from the meta (top sets for doubles and for singles). Stable ids let
 * teams reference them; editing one saves a personal copy that overrides the catalog entry.
 */
export const CATALOG_PREFIX = 'cat-';
export const isCatalogId = (id: string) => id.startsWith(CATALOG_PREFIX);

function buildsFrom(model: OpponentModel, sid: string, tag: 'd' | 's', label: string, max: number): OwnedBuild[] {
  const seen = new Set<string>();
  const out: OwnedBuild[] = [];
  for (const c of model.candidates) {
    const key = `${c.build.item ?? ''}|${c.build.alignment}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const physical = c.build.sp.atk >= c.build.sp.spa;
    out.push({
      id: `${CATALOG_PREFIX}${sid}-${tag}${out.length}`,
      name: `${label}${c.build.item ? ` · ${c.build.item}` : ''}`,
      role: physical ? 'atacante físico' : 'atacante especial',
      build: c.build,
      notes: `Build frecuente del meta (${(c.weight * 100).toFixed(0)}% de sus sets en ${label.toLowerCase()}).`,
    });
    if (out.length >= max) break;
  }
  return out;
}

export async function buildCatalog(reg: Regulation, doubles: MetaSnapshot | undefined, singles: MetaSnapshot | undefined): Promise<OwnedPokemon[]> {
  const out: OwnedPokemon[] = [];
  for (const species of previewSpecies()) {
    if (!reg.isSpeciesAllowed(species) || !getSpecies(species)) continue;
    const sid = toID(species);
    let builds: OwnedBuild[] = [];
    let usage = 0;
    try {
      const [d, s] = await Promise.all([opponentModel(species, doubles), opponentModel(species, singles)]);
      if (d.source === 'meta') builds.push(...buildsFrom(d, sid, 'd', 'Meta dobles', 2));
      if (s.source === 'meta') builds.push(...buildsFrom(s, sid, 's', 'Meta individuales', 1));
      usage = Math.max(d.usage, s.usage);
      if (!builds.length) builds = [{ id: `${CATALOG_PREFIX}${sid}-h0`, name: 'Sugerida (sin datos del meta)', role: '', build: d.candidates[0]!.build, notes: 'Hipótesis: máxima ofensiva y velocidad. No aparece en las estadísticas de uso.' }];
    } catch {
      continue; // species the engine cannot model
    }
    out.push({ id: `${CATALOG_PREFIX}${sid}`, species, nickname: '', status: 'available', favorite: false, trainable: true, modificationCost: null, notes: '', builds, source: 'catalog', usage });
  }
  return out.sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0));
}

/** Personal (saved) entries override catalog ones with the same id; usage is kept for sorting. */
export function mergeCatalog(catalog: OwnedPokemon[], saved: OwnedPokemon[]): OwnedPokemon[] {
  const byId = new Map(saved.map((p) => [p.id, p]));
  const merged = catalog.map((c) => {
    const s = byId.get(c.id);
    return s ? { ...s, source: 'edited' as const, usage: c.usage } : c;
  });
  const extra = saved.filter((p) => !isCatalogId(p.id)).map((p) => ({ ...p, source: 'custom' as const }));
  return [...extra, ...merged];
}
