/**
 * Spanish names for species, moves, abilities, items, natures and types, from PokéAPI's CSV dumps.
 *   npm run build:i18n
 * Output: data/i18n/es.json, keyed by Showdown id (toID of the English name).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv';
const ES = '7';
const EN = '9';
const toID = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

async function csv(name: string): Promise<string[][]> {
  const r = await fetch(`${BASE}/${name}.csv`, { headers: { 'User-Agent': 'pch-i18n/0.1' } });
  if (!r.ok) throw new Error(`${r.status} ${name}`);
  const text = await r.text();
  const rows: string[][] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    if (!line) continue;
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of line) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) (out.push(cur), (cur = ''));
      else cur += ch;
    }
    out.push(cur);
    rows.push(out);
  }
  return rows;
}

/** Map entity id → Spanish name, keyed by toID(English name). */
async function table(names: string, idCol = 0, langCol = 1, nameCol = 2) {
  const rows = await csv(names);
  const en = new Map<string, string>();
  const es = new Map<string, string>();
  for (const r of rows) {
    if (r[langCol] === EN) en.set(r[idCol]!, r[nameCol]!);
    if (r[langCol] === ES) es.set(r[idCol]!, r[nameCol]!);
  }
  const out: Record<string, string> = {};
  for (const [id, enName] of en) {
    const esName = es.get(id);
    if (esName && esName !== enName) out[toID(enName)] = esName;
  }
  return out;
}

const [species, moves, abilities, items, natures, types] = await Promise.all([
  table('pokemon_species_names'),
  table('move_names'),
  table('ability_names'),
  table('item_names'),
  table('nature_names'),
  table('type_names'),
]);

const out = {
  meta: { source: 'PokéAPI CSV (github.com/PokeAPI/pokeapi)', retrievedAt: new Date().toISOString(), language: 'es' },
  species,
  moves,
  abilities,
  items,
  natures,
  types,
};
const file = join(ROOT, 'data/i18n/es.json');
mkdirSync(dirname(file), { recursive: true });
writeFileSync(file, JSON.stringify(out));
console.log(Object.fromEntries(Object.entries(out).filter(([k]) => k !== 'meta').map(([k, v]) => [k, Object.keys(v).length])));
