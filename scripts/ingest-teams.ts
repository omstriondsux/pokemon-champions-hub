/**
 * Meta TEAMS (not just meta Pokémon), from the highest-rated public replays on Pokémon Showdown.
 *
 *   npm run ingest:teams
 *
 * - Doubles: "[Gen 9 Champions] VGC 2026 Reg M-C (Bo3)" forces open team sheets, so each replay carries
 *   both players' full teams (species, item, ability, moves, nature) in its |showteam| lines. Only the
 *   Stat Points are hidden: they are filled with the most common spread of that Pokémon (same nature if possible).
 * - Singles: BSS has no team sheets, so the 6 Pokémon are the real team (team preview) and each set is
 *   the most likely one from the usage stats, plus every move the player actually used in that game.
 * - No player names are stored: only the rating, the date and the public replay id.
 * - Writes data/teams/{doubles,singles}.json atomically; on failure the previous file is kept.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Teams } from '@pkmn/sim';
import { dex } from '../packages/engine/src/data/dex.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data/teams');
const SNAP = join(ROOT, 'data/snapshots/smogon');
const API = 'https://replay.pokemonshowdown.com';
const UA = 'champions-hub-ingest/0.2 (open-source, non-commercial; weekly)';
const KEEP = 40;
const MIN_RATING = 1450;

type Mode = 'singles' | 'doubles';
interface Set6 {
  species: string;
  item?: string;
  ability: string;
  alignment: string;
  moves: string[];
  sp: Record<'hp' | 'atk' | 'def' | 'spa' | 'spd' | 'spe', number>;
}
interface MetaTeam {
  id: string;
  mode: Mode;
  rating: number;
  date: string;
  replay: string;
  seen: number; // how many times this exact 6 was seen among top replays
  setsFrom: 'team-sheet' | 'usage';
  members: Set6[];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as T;
}

// ---- usage snapshot: spreads / items / abilities / moves per species
function latestSnapshot(mode: Mode): Record<string, any> {
  const idx = JSON.parse(readFileSync(join(SNAP, 'index.json'), 'utf8'));
  const e = (idx.snapshots as any[]).filter((s) => s.mode === mode).sort((a, b) => b.month.localeCompare(a.month) || b.ratingCutoff - a.ratingCutoff)[0];
  return e ? JSON.parse(readFileSync(join(SNAP, e.file.replace(/^smogon\//, '')), 'utf8')).pokemon : {};
}
const topKey = (rec: Record<string, number> | undefined) => (rec ? Object.entries(rec).sort((a, b) => b[1] - a[1])[0]?.[0] : undefined);
function spreadFor(snap: Record<string, any>, species: string, nature?: string): { alignment: string; sp: Set6['sp'] } {
  const m = snap[species] ?? Object.entries(snap).find(([k]) => k.startsWith(`${species}-Mega`))?.[1];
  const entries = Object.entries((m?.spreads ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]);
  const pick = (nature && entries.find(([k]) => k.startsWith(`${nature}:`))) || entries[0];
  const mm = pick && /^([A-Za-z]+):(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/.exec(pick[0]);
  if (mm) return { alignment: nature ?? mm[1]!, sp: { hp: +mm[2]!, atk: +mm[3]!, def: +mm[4]!, spa: +mm[5]!, spd: +mm[6]!, spe: +mm[7]! } };
  // no data: a generic bulky-offensive spread on the better attacking stat
  const base = dex.species.get(species).baseStats;
  const phys = base.atk >= base.spa;
  return { alignment: nature ?? (phys ? 'Adamant' : 'Modest'), sp: { hp: 32, atk: phys ? 32 : 0, def: 0, spa: phys ? 0 : 32, spd: 0, spe: 2 } };
}
const name = {
  item: (s?: string) => (s ? dex.items.get(s).name || s : undefined),
  ability: (s: string) => dex.abilities.get(s).name || s,
  move: (s: string) => dex.moves.get(s).name || s,
  species: (s: string) => dex.species.get(s).name || s,
};

async function searchPages(format: string, pages: number) {
  const out: { id: string; rating: number | null; uploadtime: number }[] = [];
  for (let p = 1; p <= pages; p++) {
    const rows = await getJSON<{ id: string; rating: number | null; uploadtime: number }[]>(`${API}/search.json?format=${format}&sort=rating&page=${p}`);
    out.push(...rows);
    if (rows.length < 50) break;
    await sleep(400);
  }
  return out.filter((r) => (r.rating ?? 0) >= MIN_RATING);
}

async function doubles(): Promise<MetaTeam[]> {
  const snap = latestSnapshot('doubles');
  const rows = await searchPages('gen9championsvgc2026regmcbo3', 4);
  const teams = new Map<string, MetaTeam>();
  for (const r of rows) {
    let log: string;
    try {
      log = (await getJSON<{ log: string }>(`${API}/${r.id}.json`)).log;
    } catch {
      continue;
    }
    await sleep(250);
    for (const line of log.split('\n').filter((l) => l.startsWith('|showteam|'))) {
      const packed = line.split('|').slice(3).join('|');
      const sets = Teams.unpack(packed);
      if (!sets || sets.length < 4) continue;
      const members: Set6[] = sets.map((s) => {
        const species = name.species(s.species || s.name);
        const sp = spreadFor(snap, species, s.nature || undefined);
        return { species, item: name.item(s.item), ability: name.ability(s.ability), alignment: s.nature || sp.alignment, moves: s.moves.map(name.move), sp: sp.sp };
      });
      upsert(teams, members, 'doubles', r, 'team-sheet');
    }
  }
  return rank(teams);
}

async function singles(): Promise<MetaTeam[]> {
  const snap = latestSnapshot('singles');
  const rows = await searchPages('gen9championsbssregmc', 3);
  const teams = new Map<string, MetaTeam>();
  for (const r of rows) {
    let log: string;
    try {
      log = (await getJSON<{ log: string }>(`${API}/${r.id}.json`)).log;
    } catch {
      continue;
    }
    await sleep(250);
    const lines = log.split('\n');
    for (const side of ['p1', 'p2']) {
      const species = lines.filter((l) => l.startsWith(`|poke|${side}|`)).map((l) => name.species(l.split('|')[3]!.split(',')[0]!));
      if (species.length < 3) continue;
      // moves this player actually used, by species (nicknames resolved through switch lines)
      const nick: Record<string, string> = {};
      const used: Record<string, Set<string>> = {};
      for (const l of lines) {
        const p = l.split('|');
        if ((p[1] === 'switch' || p[1] === 'drag') && p[2]?.startsWith(side)) nick[p[2].slice(5)] = name.species(p[3]!.split(',')[0]!.replace(/-Mega.*/, ''));
        if (p[1] === 'move' && p[2]?.startsWith(side) && !l.includes('[from]')) {
          const sp = nick[p[2].slice(5)] ?? p[2].slice(5);
          (used[sp] ??= new Set()).add(p[3]!);
        }
      }
      const members: Set6[] = species.map((sp) => {
        const m = snap[sp] ?? {};
        const spread = spreadFor(snap, sp);
        const seen = [...(used[sp] ?? [])];
        const likely = Object.entries((m.moves ?? {}) as Record<string, number>).sort((a, b) => b[1] - a[1]).map(([k]) => name.move(k));
        const moves = [...new Set([...seen, ...likely])].slice(0, 4);
        return { species: sp, item: name.item(topKey(m.items)), ability: name.ability(topKey(m.abilities) ?? Object.values(dex.species.get(sp).abilities)[0] ?? ''), alignment: spread.alignment, moves, sp: spread.sp };
      });
      if (members.some((x) => x.moves.length < 2)) continue;
      upsert(teams, members, 'singles', r, 'usage');
    }
  }
  return rank(teams);
}

function upsert(map: Map<string, MetaTeam>, members: Set6[], mode: Mode, r: { id: string; rating: number | null; uploadtime: number }, setsFrom: MetaTeam['setsFrom']) {
  const key = members.map((m) => m.species).sort().join('|');
  const prev = map.get(key);
  const rating = r.rating ?? 0;
  if (prev) {
    prev.seen++;
    if (rating > prev.rating) Object.assign(prev, { rating, replay: r.id, date: new Date(r.uploadtime * 1000).toISOString().slice(0, 10), members });
    return;
  }
  map.set(key, { id: key.toLowerCase().replace(/[^a-z|]/g, '').slice(0, 80), mode, rating, date: new Date(r.uploadtime * 1000).toISOString().slice(0, 10), replay: r.id, seen: 1, setsFrom, members });
}
const rank = (m: Map<string, MetaTeam>) =>
  [...m.values()].sort((a, b) => b.seen - a.seen || b.rating - a.rating).slice(0, KEEP);

function write(mode: Mode, teams: MetaTeam[]) {
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `${mode}.json`);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), source: 'Pokémon Showdown public replays (highest rated)', mode, teams }, null, 1));
  renameSync(tmp, file);
}

for (const [mode, fn] of [['doubles', doubles], ['singles', singles]] as const) {
  try {
    const t = await fn();
    if (t.length < 5) throw new Error(`only ${t.length} teams`);
    write(mode, t);
    console.log(`${mode}: ${t.length} equipos (top: ${t[0]!.members.map((m) => m.species).join(', ')} · ${t[0]!.rating})`);
  } catch (e) {
    console.error(`${mode}: no se actualizó (${String(e)}); se conserva ${existsSync(join(OUT, `${mode}.json`)) ? 'el archivo anterior' : 'nada'}`);
  }
}
