/**
 * Validates every regulation pack in /data/regulations and reports rules that are not verified.
 *   npm run validate:rules
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Regulation } from '../packages/engine/src/index.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../data/regulations');
let failed = false;

function walk(obj: unknown, path: string[], out: string[]) {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  if ('confidence' in o && 'value' in o) {
    if (o.confidence !== 'verified') out.push(`  ${String(o.confidence).padEnd(9)} ${path.join('.')}${o.note ? ` — ${o.note}` : ''}`);
    return;
  }
  for (const [k, v] of Object.entries(o)) walk(v, [...path, k], out);
}

for (const f of readdirSync(DIR).filter((f) => f.endsWith('.json'))) {
  try {
    const reg = new Regulation(JSON.parse(readFileSync(join(DIR, f), 'utf8')));
    const missing = reg.missingExpectedAdditions();
    console.log(`✔ ${f}: ${reg.pack.name} (${reg.pack.validFrom.value} → ${reg.pack.validTo.value})`);
    if (missing.species.length || missing.items.length) {
      failed = true;
      console.log(`  ✖ database is missing expected additions: ${[...missing.species, ...missing.items].join(', ')} → update @smogon/calc / @pkmn/mods`);
    }
    const unverified: string[] = [];
    walk(reg.pack, [], unverified);
    if (unverified.length) console.log(`  Not verified (${unverified.length}):\n${unverified.join('\n')}`);
  } catch (e) {
    failed = true;
    console.log(`✖ ${f}: ${e}`);
  }
}
process.exitCode = failed ? 1 : 0;
