import type { Build } from '@pch/engine';

export type Mode = 'singles' | 'doubles';

export type PokemonStatus = 'available' | 'pending_recruit' | 'temporary' | 'pending_training' | 'transferable' | 'unavailable';

export interface OwnedBuild {
  id: string;
  name: string;
  role: string;
  build: Build;
  notes: string;
}

export interface OwnedPokemon {
  id: string;
  species: string;
  nickname: string;
  status: PokemonStatus;
  favorite: boolean;
  trainable: boolean;
  modificationCost: number | null;
  notes: string;
  builds: OwnedBuild[];
  updatedAt?: string;
  /** catalog = auto-generated from the meta; edited = catalog entry you changed; custom = added by you. */
  source?: 'catalog' | 'edited' | 'custom';
  usage?: number;
}

export interface Team {
  id: string;
  name: string;
  format: Mode;
  regulation: string;
  members: { pokemonId: string; buildId: string }[];
  notes: string;
  updatedAt?: string;
}

export interface BattleRecord {
  id: string;
  date: string;
  regulation: string;
  format: Mode;
  teamId: string | null;
  myTeam: Build[];
  mySelection: number[];
  myLeads: number[];
  opponentTeam: string[];
  opponentSelection: string[];
  opponentReveals: Record<string, { moves: string[]; item?: string; ability?: string }>;
  result: 'win' | 'loss' | 'draw';
  reason: string;
  mistakes: string[];
  notes: string;
  advisorFollowed: 'best' | 'conservative' | 'aggressive' | 'own' | null;
  updatedAt?: string;
}

export interface Settings {
  lang: 'es' | 'en';
  theme: 'dark' | 'light';
  defaultMode: Mode;
  ratingCutoff: number;
  vpCostPerPoint: number | null;
  activeTeam: Partial<Record<Mode, string>>;
  /** Assume every Pokémon of the regulation is owned (catalog with meta builds). */
  ownAll: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lang: 'es',
  theme: 'dark',
  defaultMode: 'doubles',
  ratingCutoff: 1630,
  vpCostPerPoint: null,
  activeTeam: {},
  ownAll: true,
};

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
