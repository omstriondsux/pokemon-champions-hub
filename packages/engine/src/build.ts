import type { StatID } from '@smogon/calc';

export type StatTable = Record<StatID, number>;
export const STAT_IDS: StatID[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'];

export const zeroStats = (): StatTable => ({ hp: 0, atk: 0, def: 0, spa: 0, spd: 0, spe: 0 });

/** One concrete configuration of a Pokémon. An owned Pokémon can have several. */
export interface Build {
  species: string; // registered (base) forme, e.g. "Garchomp" — megas come from the item
  ability: string;
  item?: string;
  /** Stat Alignment (the Champions name for nature). Uses nature names: "Jolly", "Modest"... */
  alignment: string;
  moves: string[];
  sp: StatTable;
}

export function makeBuild(b: Omit<Build, 'sp'> & { sp?: Partial<StatTable> }): Build {
  return { ...b, sp: { ...zeroStats(), ...b.sp } };
}

export const totalSp = (sp: StatTable) => STAT_IDS.reduce((s, k) => s + sp[k], 0);
