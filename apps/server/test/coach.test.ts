import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Store } from '../src/db.js';

const dir = mkdtempSync(join(tmpdir(), 'pch-coach-'));
const app = createApp({ store: new Store(':memory:'), dataDir: dir });
const put = (key: string) => app.request('/api/coach/key', { method: 'PUT', body: JSON.stringify({ key }), headers: { 'Content-Type': 'application/json' } });

describe('coach key handling', () => {
  it('rejects malformed keys and never returns the key', async () => {
    expect((await put('not-a-key-at-all-123456')).status).toBe(400);
    expect((await put('sk-ant-test-0000000000000000000000')).status).toBe(200);
    const status = await (await app.request('/api/coach/status')).text();
    expect(status).not.toContain('sk-ant');
    expect(JSON.parse(status).source).toBe('file');
    expect(readFileSync(join(dir, 'secrets.json'), 'utf8')).toContain('sk-ant-test');
    expect((await app.request('/api/coach/key', { method: 'DELETE' })).status).toBe(200);
  });

  it('validates chat requests', async () => {
    const r = await app.request('/api/coach/chat', { method: 'POST', body: JSON.stringify({ context: '', messages: [] }), headers: { 'Content-Type': 'application/json' } });
    expect(r.status).toBe(400);
  });
});
