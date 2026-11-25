async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const issues = (body as { issues?: { path: string[]; message: string }[] }).issues;
    throw new Error(issues ? issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') : (body as { error?: string }).error ?? r.statusText);
  }
  return body as T;
}

export const api = {
  list: <T>(c: 'pokemon' | 'teams' | 'battles') => req<T[]>(`/api/${c}`),
  put: <T extends { id: string }>(c: 'pokemon' | 'teams' | 'battles', doc: T) => req<T>(`/api/${c}/${doc.id}`, { method: 'PUT', body: JSON.stringify(doc) }),
  del: (c: 'pokemon' | 'teams' | 'battles', id: string) => req<{ ok: true }>(`/api/${c}/${id}`, { method: 'DELETE' }),
  settings: () => req<Record<string, unknown>>('/api/settings'),
  putSettings: (s: Record<string, unknown>) => req<Record<string, unknown>>('/api/settings', { method: 'PUT', body: JSON.stringify(s) }),
  regulations: () => req<unknown[]>('/api/regulations'),
  metaIndex: () => req<{ month?: string; snapshots: { file: string; mode: string; ratingCutoff: number; month: string; battles: number; regulation: string }[] }>('/api/meta/index'),
  snapshot: <T>(file: string) => req<T>(`/api/meta/snapshot?file=${encodeURIComponent(file)}`),
  i18n: (lang: string) => req<Record<string, Record<string, string>>>(`/api/i18n/${lang}`),
  exportAll: () => req<unknown>('/api/export'),
  importAll: (data: unknown, mode: 'merge' | 'replace') => req<{ imported: Record<string, number> }>(`/api/import?mode=${mode}`, { method: 'POST', body: JSON.stringify(data) }),
};
