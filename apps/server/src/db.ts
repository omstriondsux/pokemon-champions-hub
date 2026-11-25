import type { DatabaseSync as DatabaseSyncT } from 'node:sqlite';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// Loaded via require: Vite/Vitest's resolver does not know "node:sqlite" as a builtin yet.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = DatabaseSyncT;

/**
 * Local SQLite store (node:sqlite, no native dependencies).
 * Collections are stored as JSON documents validated by zod at the API boundary:
 * the shapes will evolve with the app and a document store keeps migrations trivial.
 */
export const COLLECTIONS = ['pokemon', 'teams', 'battles'] as const;
export type Collection = (typeof COLLECTIONS)[number];

export interface Doc {
  id: string;
  [k: string]: unknown;
}

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly file: string) {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS docs (
        collection TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection, id)
      );
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT OR IGNORE INTO meta (key, value) VALUES ('schemaVersion', '1');
    `);
  }

  list(c: Collection): Doc[] {
    return this.db
      .prepare('SELECT data FROM docs WHERE collection = ? ORDER BY updated_at DESC')
      .all(c)
      .map((r) => JSON.parse((r as { data: string }).data) as Doc);
  }

  get(c: Collection, id: string): Doc | undefined {
    const r = this.db.prepare('SELECT data FROM docs WHERE collection = ? AND id = ?').get(c, id) as { data: string } | undefined;
    return r ? (JSON.parse(r.data) as Doc) : undefined;
  }

  put(c: Collection, doc: Doc): Doc {
    const now = new Date().toISOString();
    const withTs = { ...doc, updatedAt: now };
    this.db
      .prepare('INSERT INTO docs (collection, id, data, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(collection, id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .run(c, doc.id, JSON.stringify(withTs), now);
    return withTs;
  }

  delete(c: Collection, id: string): boolean {
    return Number(this.db.prepare('DELETE FROM docs WHERE collection = ? AND id = ?').run(c, id).changes) > 0;
  }

  getSettings(): Record<string, unknown> {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    return Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  }

  putSettings(s: Record<string, unknown>) {
    const stmt = this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    for (const [k, v] of Object.entries(s)) stmt.run(k, JSON.stringify(v));
    return this.getSettings();
  }

  exportAll() {
    return {
      format: 'pch-export',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: this.getSettings(),
      ...Object.fromEntries(COLLECTIONS.map((c) => [c, this.list(c)])),
    } as Record<string, unknown>;
  }

  /** mode "merge" upserts by id; mode "replace" wipes each imported collection first. Atomic. */
  importAll(data: Record<string, unknown>, mode: 'merge' | 'replace') {
    const counts: Record<string, number> = {};
    this.db.exec('BEGIN');
    try {
      for (const c of COLLECTIONS) {
        const docs = data[c];
        if (!Array.isArray(docs)) continue;
        if (mode === 'replace') this.db.prepare('DELETE FROM docs WHERE collection = ?').run(c);
        for (const d of docs as Doc[]) {
          if (typeof d?.id !== 'string') throw new Error(`${c}: document without id`);
          this.put(c, d);
        }
        counts[c] = docs.length;
      }
      if (data.settings && typeof data.settings === 'object') this.putSettings(data.settings as Record<string, unknown>);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return counts;
  }

  /** Daily file backup, keeping the most recent `keep`. */
  backup(dir: string, keep = 14): string | undefined {
    if (this.file === ':memory:' || !existsSync(this.file)) return undefined;
    mkdirSync(dir, { recursive: true });
    const target = join(dir, `hub-${new Date().toISOString().slice(0, 10)}.db`);
    if (!existsSync(target)) {
      this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
      copyFileSync(this.file, target);
    }
    const files = readdirSync(dir).filter((f) => /^hub-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, f));
    return target;
  }
}
