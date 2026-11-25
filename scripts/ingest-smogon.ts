/**
 * Smogon usage-stats ingestion (Pokémon Showdown ladder data).
 *
 *   npm run ingest:smogon                       # latest month, default formats/cutoffs
 *   npm run ingest:smogon -- --month 2026-10 --cutoffs 0,1630
 *   npm run ingest:smogon -- --months 2        # latest 2 months (for trends)
 *
 * - Source: https://www.smogon.com/stats/<month>/chaos/<format>-<cutoff>.json (public, monthly).
 * - These are SIMULATOR stats: they are labelled as such and never presented as official in-game data.
 * - Writes atomically; on any failure the previous snapshot is kept and the error is logged.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'data/snapshots/smogon');
const LOG = join(ROOT, 'data/snapshots/ingest-log.jsonl');
const BASE = 'https://www.smogon.com/stats';
const UA = 'champions-hub-ingest/0.2 (open-source, non-commercial; monthly)';

/** Showdown format per game mode. BSS = the singles format that mirrors in-game ranked (bring 3). */
const FORMAT_PATTERNS: Record<'singles' | 'doubles', RegExp> = {
  singles: /^gen9championsbssreg(m[a-z])$/,
  doubles: /^gen9championsvgc\d{4}reg(m[a-z])$/,
};

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i]!.replace(/^--/, ''), process.argv[i + 1] ?? '');
const CUTOFFS = (args.get('cutoffs') ?? '0,1500,1630').split(',').map(Number);

const TOP = { moves: 20, items: 12, abilities: 4, spreads: 15, teammates: 20, counters: 12 };
const MIN_RAW = 50;

type Weights = Record<string, number>;
interface ChaosMon {
  'Raw count': number;
  usage: number;
  Abilities: Weights;
  Items: Weights;
  Spreads: Weights;
  Moves: Weights;
  Teammates: Weights;
  'Checks and Counters': Record<string, { n: number; p: number; d: number }> | Record<string, number[]>;
}
interface Chaos {
  info: { metagame: string; cutoff: number; 'number of battles': number };
  data: Record<string, ChaosMon>;
}

async function get(url: string): Promise<Response> {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${url}`);
  return r;
}

async function latestMonths(n: number): Promise<string[]> {
  const html = await (await get(`${BASE}/`)).text();
  const months = [...html.matchAll(/href="(\d{4}-\d{2})\/"/g)].map((m) => m[1]!).sort();
  if (!months.length) throw new Error('No months found on smogon.com/stats');
  return months.slice(-n);
}

async function listFormats(month: string): Promise<string[]> {
  const html = await (await get(`${BASE}/${month}/chaos/`)).text();
  return [...new Set([...html.matchAll(/href="(gen9champions[a-z0-9]+)-\d+\.json"/g)].map((m) => m[1]!))];
}

/** Normalise a weight map to probabilities and keep the top N. */
function top(w: Weights | undefined, n: number, total?: number): Record<string, number> {
  if (!w) return {};
  const sum = total ?? Object.values(w).reduce((a, b) => a + b, 0);
  if (!sum) return {};
  return Object.fromEntries(
    Object.entries(w)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => [k, +(v / sum).toFixed(5)]),
  );
}

function reliability(raw: number): 'high' | 'medium' | 'low' {
  return raw >= 10_000 ? 'high' : raw >= 1_000 ? 'medium' : 'low';
}

function transform(chaos: Chaos, mode: 'singles' | 'doubles', regulation: string, month: string, url: string) {
  const pokemon: Record<string, unknown> = {};
  for (const [name, m] of Object.entries(chaos.data)) {
    if (m['Raw count'] < MIN_RAW) continue;
    // Each team slot has exactly one ability → the ability weight sum is that species' weighted count.
    const weighted = Object.values(m.Abilities).reduce((a, b) => a + b, 0);
    const counters = Object.entries(m['Checks and Counters'] ?? {})
      .map(([k, v]) => {
        const [n, p, d] = Array.isArray(v) ? v : [v.n, v.p, v.d];
        return { against: k, n: +n!.toFixed(1), score: +(p! - 4 * d!).toFixed(4), koOrSwitchRate: +p!.toFixed(4) };
      })
      .filter((c) => c.n >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, TOP.counters);
    pokemon[name] = {
      usage: +m.usage.toFixed(5),
      rawCount: m['Raw count'],
      reliability: reliability(m['Raw count']),
      abilities: top(m.Abilities, TOP.abilities),
      items: top(m.Items, TOP.items),
      spreads: top(m.Spreads, TOP.spreads), // "Alignment:hp/atk/def/spa/spd/spe" in Stat Points
      moves: top(m.Moves, TOP.moves, weighted), // P(move in moveset); sums to ~4
      teammates: top(m.Teammates, TOP.teammates, weighted), // ≈ P(teammate | this species)
      checksAndCounters: counters,
    };
  }
  return {
    meta: {
      source: 'smogon-usage-stats',
      dataKind: 'simulator',
      disclaimer: 'Pokémon Showdown ladder data. Not official in-game statistics.',
      mode,
      regulation,
      showdownFormat: chaos.info.metagame,
      month,
      ratingCutoff: chaos.info.cutoff,
      battles: chaos.info['number of battles'],
      speciesIncluded: Object.keys(pokemon).length,
      minRawCount: MIN_RAW,
      url,
      retrievedAt: new Date().toISOString(),
      notes: [
        'usage = weighted share of teams (rating-weighted above the cutoff), not win rate.',
        'Mega formes appear as separate entries (e.g. Charizard-Mega-Y).',
        'teammates/moves are normalised by the species weighted count; small samples are noisy.',
      ],
    },
    pokemon,
  };
}

function log(entry: Record<string, unknown>) {
  mkdirSync(dirname(LOG), { recursive: true });
  appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

function writeAtomic(path: string, data: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(data));
  JSON.parse(readFileSync(tmp, 'utf8')); // validate before replacing the last good file
  renameSync(tmp, path);
}

interface IndexEntry {
  file: string;
  month: string;
  mode: string;
  ratingCutoff: number;
  [k: string]: unknown;
}

async function ingestMonth(month: string, index: Map<string, IndexEntry>): Promise<number> {
  let failures = 0;
  let formats: string[];
  try {
    formats = await listFormats(month);
  } catch (e) {
    log({ level: 'error', month, error: String(e) });
    return 1;
  }
  for (const mode of ['singles', 'doubles'] as const) {
    const fmt = formats.find((f) => FORMAT_PATTERNS[mode].test(f));
    if (!fmt) {
      log({ level: 'warn', mode, month, message: 'no matching Champions format this month' });
      console.warn(`[${mode}] no Champions format found for ${month}`);
      continue;
    }
    const reg = FORMAT_PATTERNS[mode].exec(fmt)![1]!.toUpperCase().replace(/^M/, 'M-'); // "mc" → "M-C"
    for (const cutoff of CUTOFFS) {
      const rel = `smogon/${month}/${mode}-${cutoff}.json`;
      const out = join(OUT_DIR, month, `${mode}-${cutoff}.json`);
      if (existsSync(out) && !args.has('force') && month !== [...index.values()].map((e) => e.month).sort().at(-1)) {
        continue; // past months are immutable on Smogon: skip re-download
      }
      const url = `${BASE}/${month}/chaos/${fmt}-${cutoff}.json`;
      try {
        const chaos = (await (await get(url)).json()) as Chaos;
        const snap = transform(chaos, mode, reg, month, url);
        writeAtomic(out, snap);
        index.set(rel, { ...snap.meta, file: rel });
        log({ level: 'info', mode, cutoff, month, battles: snap.meta.battles, species: snap.meta.speciesIncluded });
        console.log(`[${mode} ${cutoff}] ${fmt}: ${snap.meta.battles} battles, ${snap.meta.speciesIncluded} species → ${out}`);
      } catch (e) {
        failures++;
        log({ level: 'error', mode, cutoff, month, url, error: String(e), kept: existsSync(out) ? out : null });
        console.error(`[${mode} ${cutoff}] FAILED, previous snapshot kept if any: ${e}`);
      }
    }
  }
  return failures;
}

async function main() {
  const months = args.get('month') ? [args.get('month')!] : await latestMonths(Number(args.get('months') ?? 2));
  const indexFile = join(OUT_DIR, 'index.json');
  const index = new Map<string, IndexEntry>();
  if (existsSync(indexFile)) for (const e of (JSON.parse(readFileSync(indexFile, 'utf8')).snapshots ?? []) as IndexEntry[]) index.set(e.file, e);
  let failures = 0;
  for (const m of months) failures += await ingestMonth(m, index);
  const snapshots = [...index.values()].sort((a, b) => b.month.localeCompare(a.month) || a.mode.localeCompare(b.mode) || a.ratingCutoff - b.ratingCutoff);
  writeAtomic(indexFile, { updatedAt: new Date().toISOString(), month: snapshots[0]?.month, snapshots });
  if (failures) process.exitCode = 1;
}

main().catch((e) => {
  log({ level: 'error', error: String(e) });
  console.error(e);
  process.exitCode = 1;
});
