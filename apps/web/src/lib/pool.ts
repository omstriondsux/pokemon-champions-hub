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

export function poolFrom(pokemon: OwnedPokemon[], speciesName: (s: string) => string, opts: { includePending?: boolean } = {}): PoolEntry[] {
  return pokemon
    .filter((p) => p.status !== 'unavailable' && (opts.includePending || p.status === 'available' || p.status === 'temporary'))
    .flatMap((p) =>
      p.builds.map((b) => ({
        id: b.id,
        ownerId: p.id,
        label: `${p.nickname || speciesName(p.species)} · ${b.name}`,
        build: b.build,
        favorite: p.favorite,
        cost: STATUS_COST[p.status] + (p.modificationCost ?? 0) / 500,
      })),
    );
}

export function usePool(includePending: boolean) {
  const { pokemon, names } = useApp();
  return useMemo(() => poolFrom(pokemon, names.species, { includePending }), [pokemon, names, includePending]);
}
