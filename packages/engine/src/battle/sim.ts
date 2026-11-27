import { Battle, Dex, PRNG, Teams, toID } from '@pkmn/sim';
import * as champions from '@pkmn/mods/champions';
import type { Build, StatTable } from '../build.js';

/**
 * Pokémon Showdown's battle engine (@pkmn/sim, MIT) with the Champions mod:
 * Stat Points as "EVs" (HP = base + SP + 75), level 50, Champions formats (Reg M-C).
 * Everything here runs locally (browser worker or Node): no server.
 */
let ready = false;
export function setupChampions() {
  if (ready) return;
  Dex.mod('champions' as never, champions as never);
  (Dex.formats as unknown as { extend(f: unknown): void }).extend((champions as unknown as { Formats: unknown }).Formats);
  ready = true;
}

export type BattleMode = 'singles' | 'doubles';
export const FORMAT_ID: Record<BattleMode, string> = {
  doubles: 'gen9championsvgc2026regmc',
  singles: 'gen9championsbssregmc',
};
export const PICK: Record<BattleMode, number> = { doubles: 4, singles: 3 };

/** Our Build → a Showdown set (SP go in "evs", IVs are irrelevant in Champions but must be present). */
export function toShowdownSet(b: Build) {
  return {
    name: b.species,
    species: b.species,
    item: b.item ?? '',
    ability: b.ability,
    nature: b.alignment,
    moves: b.moves.slice(0, 4),
    evs: { ...b.sp },
    ivs: { hp: 31, atk: 31, def: 31, spa: 31, spd: 31, spe: 31 },
    level: 50,
    gender: '',
    shiny: false,
  };
}

export function packTeam(builds: Build[]): string {
  return Teams.pack(builds.map((b) => toShowdownSet(b)) as never);
}

export function newBattle(mode: BattleMode, p1: { name: string; team: Build[] }, p2: { name: string; team: Build[] }, seed?: number[]): Battle {
  setupChampions();
  const s = seed ?? [1, 2, 3, 4].map(() => Math.floor(Math.random() * 0x10000));
  const battle = new Battle({ formatid: toID(FORMAT_ID[mode]), seed: s as never });
  battle.setPlayer('p1', { name: p1.name, team: packTeam(p1.team) });
  battle.setPlayer('p2', { name: p2.name, team: packTeam(p2.team) });
  return battle;
}

/** Cheap deep copy for look-ahead: serialise once, deserialise per simulation. */
export function serialize(b: Battle): unknown {
  return (b as unknown as { toJSON(): unknown }).toJSON();
}
export function restore(json: unknown, seed?: number[]): Battle {
  const c = (Battle as unknown as { fromJSON(j: unknown): Battle }).fromJSON(json);
  const anyC = c as unknown as { log: string[]; sentLogPos: number; send: () => void; prng: PRNG };
  anyC.log = [];
  anyC.sentLogPos = 0;
  anyC.send = () => {};
  if (seed) anyC.prng = new PRNG(seed as never);
  return c;
}

/** Stats of a guessed spread, Champions formula (used to hide the human's real Stat Points from the bot). */
export function championsStats(species: string, sp: StatTable, alignment: string): StatTable {
  setupChampions();
  const d = Dex.mod('champions' as never);
  const base = d.species.get(species).baseStats;
  const nat = d.natures.get(alignment);
  const out = {} as StatTable;
  for (const k of ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const) {
    if (k === 'hp') out.hp = base.hp + sp.hp + 75;
    else {
      const raw = base[k] + sp[k] + 20;
      const m = nat.plus === k ? 1.1 : nat.minus === k ? 0.9 : 1;
      out[k] = Math.floor(raw * m);
    }
  }
  return out;
}
