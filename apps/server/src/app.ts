import { Hono } from 'hono';
import { z } from 'zod';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize, sep } from 'node:path';
import { COLLECTIONS, type Collection, type Store } from './db.js';

const StatTable = z.object({ hp: z.number().int(), atk: z.number().int(), def: z.number().int(), spa: z.number().int(), spd: z.number().int(), spe: z.number().int() });
const Build = z.object({
  species: z.string().min(1),
  ability: z.string(),
  item: z.string().optional(),
  alignment: z.string(),
  moves: z.array(z.string()).max(4),
  sp: StatTable,
});
const OwnedBuild = z.object({ id: z.string(), name: z.string(), role: z.string().default(''), build: Build, notes: z.string().default('') });

export const PokemonStatus = z.enum(['available', 'pending_recruit', 'temporary', 'pending_training', 'transferable', 'unavailable']);

const schemas: Record<Collection, z.ZodTypeAny> = {
  pokemon: z.object({
    id: z.string(),
    species: z.string().min(1),
    nickname: z.string().default(''),
    status: PokemonStatus.default('available'),
    favorite: z.boolean().default(false),
    trainable: z.boolean().default(true),
    modificationCost: z.number().nullable().default(null), // VP, user-entered
    notes: z.string().default(''),
    builds: z.array(OwnedBuild).default([]),
  }),
  teams: z.object({
    id: z.string(),
    name: z.string().min(1),
    format: z.enum(['singles', 'doubles']),
    regulation: z.string(),
    members: z.array(z.object({ pokemonId: z.string(), buildId: z.string() })).max(6),
    notes: z.string().default(''),
  }),
  battles: z.object({
    id: z.string(),
    date: z.string(),
    regulation: z.string(),
    format: z.enum(['singles', 'doubles']),
    teamId: z.string().nullable().default(null),
    myTeam: z.array(Build).default([]), // snapshot of the builds used (teams can change later)
    mySelection: z.array(z.number().int()).default([]),
    myLeads: z.array(z.number().int()).default([]),
    opponentTeam: z.array(z.string()).max(6),
    opponentSelection: z.array(z.string()).default([]),
    opponentReveals: z.record(z.object({ moves: z.array(z.string()).default([]), item: z.string().optional(), ability: z.string().optional() })).default({}),
    result: z.enum(['win', 'loss', 'draw']),
    reason: z.string().default(''),
    mistakes: z.array(z.string()).default([]),
    notes: z.string().default(''),
    advisorFollowed: z.enum(['best', 'conservative', 'aggressive', 'own']).nullable().default(null),
  }),
};

export interface AppOptions {
  store: Store;
  dataDir: string; // repo /data
  updater?: { getStatus: () => unknown; run: (t: 'manual') => boolean };
}

export function createApp({ store, dataDir, updater }: AppOptions) {
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof z.ZodError) return c.json({ error: 'validation', issues: err.issues }, 400);
    console.error(err);
    return c.json({ error: String(err.message ?? err) }, 500);
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  for (const col of COLLECTIONS) {
    app.get(`/api/${col}`, (c) => c.json(store.list(col)));
    app.get(`/api/${col}/:id`, (c) => {
      const d = store.get(col, c.req.param('id'));
      return d ? c.json(d) : c.json({ error: 'not found' }, 404);
    });
    app.put(`/api/${col}/:id`, async (c) => {
      const body = schemas[col].parse({ ...(await c.req.json()), id: c.req.param('id') });
      return c.json(store.put(col, body));
    });
    app.delete(`/api/${col}/:id`, (c) => (store.delete(col, c.req.param('id')) ? c.json({ ok: true }) : c.json({ error: 'not found' }, 404)));
  }

  app.get('/api/settings', (c) => c.json(store.getSettings()));
  app.put('/api/settings', async (c) => c.json(store.putSettings(z.record(z.unknown()).parse(await c.req.json()))));

  app.get('/api/export', (c) => {
    c.header('Content-Disposition', `attachment; filename="pch-backup-${new Date().toISOString().slice(0, 10)}.json"`);
    return c.json(store.exportAll());
  });
  app.post('/api/import', async (c) => {
    const mode = c.req.query('mode') === 'replace' ? 'replace' : 'merge';
    const data = z.record(z.unknown()).parse(await c.req.json());
    if (data.format !== 'pch-export') return c.json({ error: 'Not a pch-export file' }, 400);
    for (const col of COLLECTIONS) {
      if (Array.isArray(data[col])) data[col] = (data[col] as unknown[]).map((d) => schemas[col].parse(d));
    }
    return c.json({ mode, imported: store.importAll(data, mode) });
  });

  // ---- read-only data: regulation packs, meta snapshots, i18n ----
  const readJson = (rel: string) => JSON.parse(readFileSync(join(dataDir, rel), 'utf8'));
  const safe = (rel: string) => {
    const p = normalize(join(dataDir, rel));
    if (!p.startsWith(normalize(dataDir) + sep)) throw new Error('bad path');
    return p;
  };

  app.get('/api/regulations', (c) => c.json(readdirSync(join(dataDir, 'regulations')).filter((f) => f.endsWith('.json')).map((f) => readJson(`regulations/${f}`))));
  app.get('/api/meta/index', (c) => {
    const p = join(dataDir, 'snapshots/smogon/index.json');
    return c.json(existsSync(p) ? readJson('snapshots/smogon/index.json') : { snapshots: [] });
  });
  app.get('/api/meta/snapshot', (c) => {
    const file = c.req.query('file') ?? '';
    if (!/^smogon\/\d{4}-\d{2}\/(singles|doubles)-\d+\.json$/.test(file)) return c.json({ error: 'bad file' }, 400);
    const p = safe(`snapshots/${file}`);
    return existsSync(p) ? c.json(JSON.parse(readFileSync(p, 'utf8'))) : c.json({ error: 'not found' }, 404);
  });
  app.get('/api/meta/status', (c) => c.json(updater?.getStatus() ?? { running: false, log: [], disabled: true }));
  app.post('/api/meta/refresh', (c) => (updater ? c.json({ started: updater.run('manual') }) : c.json({ error: 'updater not available' }, 503)));

  app.get('/api/i18n/:lang', (c) => {
    const lang = c.req.param('lang');
    if (!/^[a-z]{2}$/.test(lang)) return c.json({ error: 'bad lang' }, 400);
    const p = safe(`i18n/${lang}.json`);
    return existsSync(p) ? c.json(JSON.parse(readFileSync(p, 'utf8'))) : c.json({});
  });

  return app;
}
