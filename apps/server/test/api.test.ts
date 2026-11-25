import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';

const DATA = join(__dirname, '../../../data');
const app = () => createApp({ store: new Store(':memory:'), dataDir: DATA });
const json = (body: unknown) => ({ method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
const chomp = { species: 'Garchomp', ability: 'Rough Skin', alignment: 'Jolly', moves: ['Earthquake'], sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } };

describe('API', () => {
  it('CRUD pokemon with multiple builds', async () => {
    const a = app();
    const put = await a.request('/api/pokemon/p1', json({ species: 'Garchomp', builds: [{ id: 'b1', name: 'Físico', build: chomp }, { id: 'b2', name: 'Scarf', build: { ...chomp, item: 'Choice Scarf' } }] }));
    expect(put.status).toBe(200);
    const list = await (await a.request('/api/pokemon')).json();
    expect(list).toHaveLength(1);
    expect(list[0].builds).toHaveLength(2);
    expect(list[0].status).toBe('available');
    expect((await a.request('/api/pokemon/p1', { method: 'DELETE' })).status).toBe(200);
    expect(await (await a.request('/api/pokemon')).json()).toHaveLength(0);
  });

  it('rejects invalid documents', async () => {
    const r = await app().request('/api/pokemon/p1', json({ species: '' }));
    expect(r.status).toBe(400);
  });

  it('export → import round-trip (replace is atomic)', async () => {
    const a = app();
    await a.request('/api/pokemon/p1', json({ species: 'Garchomp' }));
    const dump = await (await a.request('/api/export')).json();
    const b = app();
    const r = await b.request('/api/import?mode=replace', { method: 'POST', body: JSON.stringify(dump), headers: { 'Content-Type': 'application/json' } });
    expect((await r.json()).imported.pokemon).toBe(1);
    const bad = await b.request('/api/import?mode=replace', { method: 'POST', body: JSON.stringify({ ...dump, pokemon: [{ species: 'X' }] }), headers: { 'Content-Type': 'application/json' } });
    expect(bad.status).toBe(400);
    expect(await (await b.request('/api/pokemon')).json()).toHaveLength(1); // untouched
  });

  it('serves regulations, meta index and snapshots; blocks path traversal', async () => {
    const a = app();
    const regs = await (await a.request('/api/regulations')).json();
    expect(regs.map((r: { id: string }) => r.id)).toContain('M-C');
    const idx = await (await a.request('/api/meta/index')).json();
    expect(idx.snapshots.length).toBeGreaterThan(0);
    const snap = await (await a.request(`/api/meta/snapshot?file=${idx.snapshots[0].file}`)).json();
    expect(snap.meta.dataKind).toBe('simulator');
    expect((await a.request('/api/meta/snapshot?file=../regulations/M-C.json')).status).toBe(400);
  });
});
