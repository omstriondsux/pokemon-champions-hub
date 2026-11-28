/**
 * Data access. Two backends behind one interface:
 *  - local server (npm start): SQLite on the user's PC, Smogon auto-updater, AI key kept server-side;
 *  - static web (VITE_STATIC=1, GitHub Pages): each visitor's data lives in their own browser
 *    (localStorage), and regulations / meta snapshots / translations ship as build-time files.
 */
export const STATIC = import.meta.env.VITE_STATIC === '1';

type Col = 'pokemon' | 'teams' | 'battles';
const COLS: Col[] = ['pokemon', 'teams', 'battles'];
/** Real teams from the highest-rated Showdown replays (scripts/ingest-teams.ts). */
export interface MetaTeam {
  id: string;
  mode: 'singles' | 'doubles';
  rating: number;
  date: string;
  replay: string;
  seen: number;
  setsFrom: 'team-sheet' | 'usage';
  members: { species: string; item?: string; ability: string; alignment: string; moves: string[]; sp: { hp: number; atk: number; def: number; spa: number; spd: number; spe: number } }[];
}
export interface MetaTeamsFile {
  updatedAt?: string;
  teams: MetaTeam[];
}
type MetaIndex = { month?: string; updatedAt?: string; snapshots: { file: string; mode: string; ratingCutoff: number; month: string; battles: number; regulation: string }[] };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const issues = (body as { issues?: { path: string[]; message: string }[] }).issues;
    throw new Error(issues ? issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (body as { error?: string }).error ?? r.statusText);
  }
  return body as T;
}

const server = {
  list: <T>(c: Col) => req<T[]>(`/api/${c}`),
  put: <T extends { id: string }>(c: Col, doc: T) => req<T>(`/api/${c}/${doc.id}`, { method: 'PUT', body: JSON.stringify(doc) }),
  del: (c: Col, id: string) => req<{ ok: true }>(`/api/${c}/${id}`, { method: 'DELETE' }),
  settings: () => req<Record<string, unknown>>('/api/settings'),
  putSettings: (s: Record<string, unknown>) => req<Record<string, unknown>>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  regulations: () => req<unknown[]>('/api/regulations'),
  metaIndex: () => req<MetaIndex>('/api/meta/index'),
  snapshot: <T>(file: string) => req<T>(`/api/meta/snapshot?file=${encodeURIComponent(file)}`),
  metaStatus: () => req<unknown>('/api/meta/status'),
  refreshMeta: () => req<{ started: boolean }>('/api/meta/refresh', { method: 'POST' }),
  i18n: (lang: string) => req<Record<string, Record<string, string>>>(`/api/i18n/${lang}`),
  metaTeams: (mode: 'singles' | 'doubles') => req<MetaTeamsFile>(`/api/meta/teams?mode=${mode}`),
  exportAll: () => req<unknown>('/api/export'),
  importAll: (data: unknown, mode: 'merge' | 'replace') => req<{ imported: Record<string, number> }>(`/api/import?mode=${mode}`, { method: 'POST', body: JSON.stringify(data) }),
};

// ---------------- static (browser-only) backend ----------------
// Build-time data, split into lazy chunks: only the snapshots actually used are downloaded.
const regFiles = import.meta.glob('../../../../data/regulations/*.json', { import: 'default' });
const i18nFiles = import.meta.glob('../../../../data/i18n/*.json', { import: 'default' });
const snapFiles = import.meta.glob('../../../../data/snapshots/smogon/*/*.json', { import: 'default' });
const indexFile = import.meta.glob('../../../../data/snapshots/smogon/index.json', { import: 'default' });
const teamFiles = import.meta.glob('../../../../data/teams/*.json', { import: 'default' });
const relKey = (prefix: string, rel: string) => `../../../../data/${prefix}${rel}`;

const LS = 'pch.db.';
function readCol(c: Col | 'settings'): Record<string, Record<string, unknown>> {
  try {
    return JSON.parse(localStorage.getItem(LS + c) ?? '{}');
  } catch {
    return {};
  }
}
function writeCol(c: Col | 'settings', v: Record<string, unknown>) {
  try {
    localStorage.setItem(LS + c, JSON.stringify(v));
  } catch (e) {
    throw new Error(`No se pudo guardar en este navegador (${String(e)}). Exporta una copia desde Ajustes.`);
  }
}
const load = async <T>(m: Record<string, () => Promise<unknown>>, key: string): Promise<T> => {
  const f = m[key];
  if (!f) throw new Error(`not found: ${key}`);
  return (await f()) as T;
};

const browser: typeof server = {
  list: async <T>(c: Col) => Object.values(readCol(c)).sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? ''))) as T[],
  put: async <T extends { id: string }>(c: Col, doc: T) => {
    const all = readCol(c);
    const withTs = { ...doc, updatedAt: new Date().toISOString() };
    all[doc.id] = withTs;
    writeCol(c, all);
    return withTs as T;
  },
  del: async (c: Col, id: string) => {
    const all = readCol(c);
    delete all[id];
    writeCol(c, all);
    return { ok: true as const };
  },
  settings: async () => readCol('settings'),
  putSettings: async (s: Record<string, unknown>) => {
    const next = { ...readCol('settings'), ...s };
    writeCol('settings', next as Record<string, unknown>);
    return next;
  },
  regulations: () => Promise.all(Object.values(regFiles).map((f) => f())),
  metaIndex: async () => {
    const f = Object.values(indexFile)[0];
    return f ? ((await f()) as MetaIndex) : { snapshots: [] };
  },
  snapshot: <T>(file: string) => load<T>(snapFiles, relKey('snapshots/', file)),
  metaStatus: async () => {
    const idx = await browser.metaIndex();
    return { running: false, log: [], indexUpdatedAt: idx.updatedAt, autoUpdateDays: 7, static: true };
  },
  refreshMeta: async () => ({ started: false }),
  metaTeams: async (mode) => (teamFiles[relKey('teams/', `${mode}.json`)] ? load<MetaTeamsFile>(teamFiles, relKey('teams/', `${mode}.json`)) : { teams: [] }),
  i18n: async (lang: string) => (i18nFiles[relKey('i18n/', `${lang}.json`)] ? load(i18nFiles, relKey('i18n/', `${lang}.json`)) : {}),
  exportAll: async () => ({
    format: 'pch-export',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: readCol('settings'),
    ...Object.fromEntries(COLS.map((c) => [c, Object.values(readCol(c))])),
  }),
  importAll: async (data: unknown, mode: 'merge' | 'replace') => {
    const d = data as Record<string, unknown>;
    if (d?.format !== 'pch-export') throw new Error('No es un archivo de copia de Champions Hub');
    const imported: Record<string, number> = {};
    for (const c of COLS) {
      const docs = Array.isArray(d[c]) ? (d[c] as { id?: unknown }[]).filter((x) => x && typeof x.id === 'string') : [];
      const all = mode === 'replace' ? {} : readCol(c);
      for (const doc of docs) all[doc.id as string] = doc as Record<string, unknown>;
      writeCol(c, all);
      imported[c] = docs.length;
    }
    if (d.settings && typeof d.settings === 'object') writeCol('settings', { ...(mode === 'replace' ? {} : readCol('settings')), ...(d.settings as object) });
    return { imported };
  },
};

export const api = STATIC ? browser : server;
