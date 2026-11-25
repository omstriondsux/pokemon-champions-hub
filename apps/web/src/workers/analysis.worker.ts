/// <reference lib="webworker" />
import {
  adviseRecruitment,
  adviseSelection,
  analyseSituation,
  buildMetaSet,
  buildSquads,
  optimizeBuild,
  opponentModel,
  Regulation,
  scoreVsMeta,
  trimModel,
  type Build,
  type MetaSet,
  type MetaSnapshot,
  type PoolEntry,
  type RecruitCandidate,
  type RegulationPack,
  type Reveals,
  type SituationInput,
  type SquadProfile,
} from '@pch/engine';

/**
 * All heavy analyses run here so the UI never blocks.
 * Snapshots are cached by URL (sent once), meta samples by (snapshot, topN), and pair evaluations
 * inside the engine — repeated analyses reuse previous work.
 */
const snapCache = new Map<string, MetaSnapshot>();
const regCache = new Map<string, Regulation>();
const metaCache = new Map<string, Promise<MetaSet>>();

type Format = 'singles' | 'doubles';
interface Base {
  id: number;
  pack: RegulationPack;
  snapshot?: MetaSnapshot;
  snapshotKey?: string;
}
export type WorkerRequest =
  | (Base & { type: 'advise'; team: Build[]; opponents: string[]; format: Format; trickRoom: boolean; history?: Record<string, Reveals[]> })
  | (Base & { type: 'metaThreats'; team: Build[]; format: Format; topN: number })
  | (Base & { type: 'optimize'; build: Build; format: Format; topN: number; teamItems?: string[] })
  | (Base & { type: 'squad'; pool: PoolEntry[]; format: Format; profile: SquadProfile; locked: string[]; topN: number })
  | (Base & { type: 'recruit'; candidates: RecruitCandidate[]; pool: PoolEntry[]; format: Format; topN: number })
  | (Base & { type: 'situation'; input: SituationInput })
  | (Base & { type: 'counter'; opponents: string[]; format: Format; trickRoom: boolean; pool: PoolEntry[]; history?: Record<string, Reveals[]> });

function reg(pack: RegulationPack) {
  const key = `${pack.id}@${pack.packVersion}`;
  if (!regCache.has(key)) regCache.set(key, new Regulation(pack));
  return regCache.get(key)!;
}
function snap(req: { snapshot?: MetaSnapshot; snapshotKey?: string }) {
  if (req.snapshot && req.snapshotKey) snapCache.set(req.snapshotKey, req.snapshot);
  return req.snapshot ?? (req.snapshotKey ? snapCache.get(req.snapshotKey) : undefined);
}
function metaSet(s: MetaSnapshot | undefined, key: string | undefined, topN: number, per = 3) {
  const k = `${key}|${topN}|${per}`;
  if (!metaCache.has(k)) metaCache.set(k, buildMetaSet(s, topN, per));
  return metaCache.get(k)!;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const r = e.data;
  try {
    const s = snap(r);
    const R = reg(r.pack);
    let result: unknown;
    switch (r.type) {
      case 'advise': {
        const models = await Promise.all(r.opponents.map((o) => opponentModel(o, s, { team: r.opponents, history: r.history?.[o] })));
        result = { result: adviseSelection(r.team, models, R, { format: r.format, trickRoom: r.trickRoom }, s?.meta), models };
        break;
      }
      case 'metaThreats': {
        const t0 = performance.now();
        const meta = await metaSet(s, r.snapshotKey, r.topN, 4);
        const scores = r.team.map((b) => scoreVsMeta(b, meta, R, { format: r.format }));
        const rows = meta.models.map((m, o) => {
          const sc = scores.map((x) => x.rows[o]!.score);
          return { species: m.species, usage: meta.usage[o]!, reliability: m.reliability, scores: sc, worst: scores.map((x) => x.rows[o]!.worst), best: Math.max(...sc) };
        });
        result = { result: { rows, elapsedMs: performance.now() - t0 } };
        break;
      }
      case 'optimize': {
        const meta = await metaSet(s, r.snapshotKey, r.topN, 3);
        result = { result: await optimizeBuild(r.build, meta, R, r.format, { teamItems: r.teamItems }) };
        break;
      }
      case 'squad': {
        const meta = await metaSet(s, r.snapshotKey, r.topN, 3);
        result = { result: buildSquads(r.pool, meta, R, r.format, r.profile, { locked: r.locked, onProgress: (p) => self.postMessage({ id: r.id, progress: p }) }) };
        break;
      }
      case 'recruit': {
        const meta = await metaSet(s, r.snapshotKey, r.topN, 3);
        result = { result: await adviseRecruitment(r.candidates, r.pool, meta, s, R, r.format) };
        break;
      }
      case 'counter': {
        // Best 6 from the available pool against THIS rival team (each rival weighted equally),
        // then the usual team-preview analysis with that team.
        const models = await Promise.all(r.opponents.map((o) => opponentModel(o, s, { team: r.opponents, history: r.history?.[o] })));
        const meta: MetaSet = { models: models.map((m) => trimModel(m, 4)), weights: models.map(() => 1 / models.length), usage: models.map((m) => m.usage) };
        const squad = buildSquads(r.pool, meta, R, r.format, 'balanced', { beam: 20, results: 1 });
        const team = (squad.teams[0]?.members ?? []).map((i) => r.pool[i]!);
        result = { result: adviseSelection(team.map((p) => p.build), models, R, { format: r.format, trickRoom: r.trickRoom }, s?.meta), models, team };
        break;
      }
      case 'situation':
        result = { result: await analyseSituation(r.input, s, R) };
        break;
    }
    self.postMessage({ id: r.id, ok: true, ...(result as object) });
  } catch (err) {
    self.postMessage({ id: r.id, ok: false, error: String(err) });
  }
};
