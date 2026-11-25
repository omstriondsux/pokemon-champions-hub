import { Sets } from '@pkmn/sets';
import { getSpecies, registeredForme } from './data/dex.js';
import { makeBuild, STAT_IDS, totalSp, zeroStats, type Build, type StatTable } from './build.js';

/**
 * Showdown paste format ("Garchomp @ Life Orb / Ability: ... / EVs: ... / Jolly Nature / - Move").
 * Champions pastes put Stat Points on the "EVs:" line. If the values look like classic EVs
 * (any > 32 or total > 66), they are converted: SP = floor((EV + 4) / 8), exact at Lv50 / IV31.
 */
export interface PasteImport {
  builds: Build[];
  warnings: string[];
}

export function evToSp(ev: number): number {
  return ev <= 0 ? 0 : Math.min(32, Math.floor((ev + 4) / 8));
}

export function importPaste(text: string): PasteImport {
  const warnings: string[] = [];
  const builds: Build[] = [];
  const chunks = text.replace(/\r/g, '').split(/\n\s*\n/).map((c) => c.trim()).filter(Boolean);
  for (const chunk of chunks) {
    const set = Sets.importSet(chunk);
    if (!set.species) {
      warnings.push(`No se pudo leer un bloque: "${chunk.split('\n')[0]}"`);
      continue;
    }
    const species = getSpecies(set.species);
    if (!species) {
      warnings.push(`Especie desconocida: ${set.species}`);
      continue;
    }
    const raw: StatTable = { ...zeroStats(), ...(set.evs ?? {}) };
    const looksLikeEVs = STAT_IDS.some((s) => raw[s] > 32) || totalSp(raw) > 66;
    const sp = looksLikeEVs ? (Object.fromEntries(STAT_IDS.map((s) => [s, evToSp(raw[s])])) as StatTable) : raw;
    if (looksLikeEVs) warnings.push(`${species.name}: EVs clásicos convertidos a Stat Points (${STAT_IDS.map((s) => sp[s]).join('/')}). Revisa el total.`);
    builds.push(
      makeBuild({
        // a mega forme in a paste means "base species holding the stone"
        species: registeredForme(species.name),
        ability: set.ability || species.abilities[0],
        item: set.item || undefined,
        alignment: set.nature || 'Hardy',
        moves: (set.moves ?? []).filter(Boolean),
        sp,
      }),
    );
  }
  return { builds, warnings };
}

export function exportPaste(builds: Build[]): string {
  return builds
    .map((b) =>
      Sets.exportSet({
        species: b.species,
        item: b.item,
        ability: b.ability,
        nature: b.alignment,
        evs: b.sp,
        moves: b.moves,
        level: 50,
      }).trim(),
    )
    .join('\n\n');
}
