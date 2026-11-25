import { useMemo } from 'react';
import type { PoolEntry } from '@pch/engine';
import { useApp } from './app';
import type { OwnedPokemon, PokemonStatus } from './types';

/** Readiness cost by status (0 = ready to use). VP cost adds on top, scaled (500 VP ≈ 1 unit). */
const STATUS_COST: Record<PokemonStatus, number> = {
  available: 0,
  temporary: 0.3,
  transferable: 1,
  pending_training: 1,
  pending_recruit: 2,
  unavailable: 99,
};

/** Catalog species considered by the optimizers: the most used ones (searching all ~380 would take minutes). */
export const CATALOG_POOL_TOP = 60;

export function poolFrom(pokemon: OwnedPokemon[], speciesName: (s: string) => string, opts: { includePending?: boolean; mode?: 'singles' | 'doubles' } = {}): PoolEntry[] {
  const tag = opts.mode === 'singles' ? '-s' : '-d';
  const catalogTop = new Set(
    pokemon
      .filter((p) => p.source === 'catalog')
      .sort((a, b) => (b.usage ?? 0) - (a.usage ?? 0))
      .slice(0, CATALOG_POOL_TOP)
      .map((p) => p.id),
  );
  return pokemon
    .filter((p) => p.status !== 'unavailable' && (opts.includePending || p.status === 'available' || p.status === 'temporary'))
    .filter((p) => p.source !== 'catalog' || p.favorite || catalogTop.has(p.id))
    .flatMap((p) => {
      // From untouched catalog entries take only the best build for this mode.
      const builds = p.source === 'catalog' ? [p.builds.find((b) => b.id.includes(tag)) ?? p.builds[0]!].filter(Boolean) : p.builds;
      return builds.map((b) => ({
        id: b.id,
        ownerId: p.id,
        label: `${p.nickname || speciesName(p.species)} · ${b.name}`,
        build: b.build,
        favorite: p.favorite,
        cost: STATUS_COST[p.status] + (p.modificationCost ?? 0) / 500,
      }));
    });
}

export function usePool(includePending: boolean) {
  const { pokemon, names, settings } = useApp();
  const mode = settings.defaultMode;
  return useMemo(() => poolFrom(pokemon, names.species, { includePending, mode }), [pokemon, names, includePending, mode]);
}
