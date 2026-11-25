/// <reference lib="webworker" />
import { adviseSelection, database, evaluatePair, getSpecies, opponentModel, Regulation, type Build, type MetaSnapshot, type RegulationPack } from '@pch/engine';

/**
 * Heavy analyses run here so the UI never blocks.
 * Snapshots are cached by URL so a ~1 MB JSON is only cloned once.
 */
const snapCache = new Map<string, MetaSnapshot>();
const regCache = new Map<string, Regulation>();

export type WorkerRequest =
  | { id: number; type: 'advise'; pack: RegulationPack; snapshot?: MetaSnapshot; snapshotKey?: string; team: Build[]; opponents: string[]; format: 'singles' | 'doubles'; trickRoom: boolean }
  | { id: number; type: 'metaThreats'; pack: RegulationPack; snapshot?: MetaSnapshot; snapshotKey?: string; team: Build[]; format: 'singles' | 'doubles'; topN: number };

function reg(pack: RegulationPack) {
  const key = `${pack.id}@${pack.packVersion}`;
  if (!regCache.has(key)) regCache.set(key, new Regulation(pack));
  return regCache.get(key)!;
}
function snap(req: { snapshot?: MetaSnapshot; snapshotKey?: string }) {
  if (req.snapshot && req.snapshotKey) snapCache.set(req.snapshotKey, req.snapshot);
  return req.snapshot ?? (req.snapshotKey ? snapCache.get(req.snapshotKey) : undefined);
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const r = e.data;
  try {
    const s = snap(r);
    const R = reg(r.pack);
    if (r.type === 'advise') {
      const opps = await Promise.all(r.opponents.map((o) => opponentModel(o, s)));
      const result = adviseSelection(r.team, opps, R, { format: r.format, trickRoom: r.trickRoom }, s?.meta);
      self.postMessage({ id: r.id, ok: true, result, models: opps });
    } else {
      const t0 = performance.now();
      const top = s ? Object.entries(s.pokemon).sort((a, b) => b[1].usage - a[1].usage) : [];
      // Group megas under their base species (what you see at team preview), keep order by usage.
      const species: string[] = [];
      for (const [name] of top) {
        const sp = getSpecies(name);
        const base = sp?.isMega ? sp.baseSpecies : name;
        if (!database.hasSpecies(base) || species.includes(base)) continue;
        species.push(base);
        if (species.length >= r.topN) break;
      }
      const rows = [];
      const skipped: string[] = [];
      for (const sp of species) {
        try {
          const model = await opponentModel(sp, s);
          const pairs = r.team.map((b) => evaluatePair(b, model, R, { format: r.format }));
          rows.push({ species: sp, usage: model.usage, reliability: model.reliability, scores: pairs.map((p) => p.score), worst: pairs.map((p) => p.worst), best: Math.max(...pairs.map((p) => p.score)) });
        } catch (err) {
          skipped.push(`${sp}: ${String(err)}`);
        }
      }
      self.postMessage({ id: r.id, ok: true, result: { rows, skipped, elapsedMs: performance.now() - t0 } });
    }
  } catch (err) {
    self.postMessage({ id: r.id, ok: false, error: String(err) });
  }
};
