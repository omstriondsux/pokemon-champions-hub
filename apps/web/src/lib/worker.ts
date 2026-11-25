import type { WorkerRequest } from '../workers/analysis.worker';

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | undefined;
let seq = 0;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; onProgress?: (p: number) => void }>();
const sentSnapshots = new Set<string>();

function get() {
  if (!worker) {
    worker = new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      if ('progress' in e.data) return p.onProgress?.(e.data.progress);
      pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data);
      else p.reject(new Error(e.data.error));
    };
  }
  return worker;
}

/** Sends a job to the analysis worker; the snapshot body is only sent the first time. */
export function runAnalysis<T = any>(req: DistributiveOmit<WorkerRequest, 'id'>, onProgress?: (p: number) => void): Promise<T> {
  const id = ++seq;
  const msg = { ...req, id } as WorkerRequest;
  if (msg.snapshotKey && sentSnapshots.has(msg.snapshotKey)) delete msg.snapshot;
  else if (msg.snapshotKey && msg.snapshot) sentSnapshots.add(msg.snapshotKey);
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    get().postMessage(msg);
  });
}
