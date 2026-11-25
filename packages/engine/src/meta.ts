/** Shape of the snapshots written by scripts/ingest-smogon.ts */
export interface MetaMon {
  usage: number;
  rawCount: number;
  reliability: 'high' | 'medium' | 'low';
  abilities: Record<string, number>; // ability id → probability
  items: Record<string, number>; // item id → probability
  spreads: Record<string, number>; // "Adamant:2/32/0/0/0/32" → probability
  moves: Record<string, number>; // move id → P(in moveset)
  teammates: Record<string, number>; // species name → ≈P(teammate)
  checksAndCounters: { against: string; n: number; score: number; koOrSwitchRate: number }[];
}

export interface MetaSnapshotMeta {
  source: string;
  dataKind: 'simulator' | 'tournament' | 'official';
  disclaimer: string;
  mode: 'singles' | 'doubles';
  regulation: string;
  showdownFormat: string;
  month: string;
  ratingCutoff: number;
  battles: number;
  speciesIncluded: number;
  url: string;
  retrievedAt: string;
}

export interface MetaSnapshot {
  meta: MetaSnapshotMeta;
  pokemon: Record<string, MetaMon>;
}

export function parseSpread(key: string): { alignment: string; sp: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } } | undefined {
  const m = /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(key);
  if (!m) return undefined;
  const [, alignment, hp, atk, def, spa, spd, spe] = m;
  return { alignment: alignment!, sp: { hp: +hp!, atk: +atk!, def: +def!, spa: +spa!, spd: +spd!, spe: +spe! } };
}

export const topEntries = (rec: Record<string, number>, n: number) =>
  Object.entries(rec)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
