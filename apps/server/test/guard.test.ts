import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';

const app = createApp({ store: new Store(':memory:'), dataDir: mkdtempSync(join(tmpdir(), 'pch-guard-')) });
const body = JSON.stringify({ format: 'pch-export', pokemon: [], teams: [], battles: [] });

describe('requests from other websites are rejected', () => {
  it('blocks a cross-site text/plain POST (CSRF)', async () => {
    const r = await app.request('/api/import?mode=replace', { method: 'POST', body, headers: { 'Content-Type': 'text/plain', Origin: 'https://evil.example', 'Sec-Fetch-Site': 'cross-site' } });
    expect(r.status).toBe(403);
  });
  it('blocks writes without a JSON content type even with no Origin', async () => {
    const r = await app.request('/api/import?mode=replace', { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });
    expect(r.status).toBe(415);
  });
  it('blocks a foreign Host (DNS rebinding)', async () => {
    const r = await app.request('http://attacker.example:8787/api/teams', { headers: { Host: 'attacker.example:8787' } });
    expect(r.status).toBe(403);
  });
  it('allows the app itself', async () => {
    const r = await app.request('http://127.0.0.1:8787/api/teams', { headers: { Host: '127.0.0.1:8787', Origin: 'http://127.0.0.1:8787', 'Sec-Fetch-Site': 'same-origin' } });
    expect(r.status).toBe(200);
  });
});
