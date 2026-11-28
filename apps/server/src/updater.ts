import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Store } from './db.js';

/**
 * Automatic, configurable data updates. Runs the Smogon ingestion script in a child process when the
 * snapshot index is older than `autoUpdateDays` (setting; 0 = off). The script writes atomically and
 * keeps the last valid snapshot on failure, so a failed update never breaks the app.
 */
export interface UpdaterStatus {
  running: boolean;
  lastStart?: string;
  lastEnd?: string;
  lastExit?: number | null;
  lastTrigger?: 'auto' | 'manual';
  log: string[];
  indexUpdatedAt?: string;
  autoUpdateDays: number;
}

export class Updater {
  private status: UpdaterStatus = { running: false, log: [], autoUpdateDays: 7 };
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly root: string,
    private readonly store: Store,
  ) {}

  private indexUpdatedAt(): string | undefined {
    const p = join(this.root, 'data/snapshots/smogon/index.json');
    if (!existsSync(p)) return undefined;
    try {
      return JSON.parse(readFileSync(p, 'utf8')).updatedAt;
    } catch {
      return undefined;
    }
  }

  private days(): number {
    const v = this.store.getSettings().autoUpdateDays;
    return typeof v === 'number' && v >= 0 ? v : 7;
  }

  getStatus(): UpdaterStatus {
    return { ...this.status, indexUpdatedAt: this.indexUpdatedAt(), autoUpdateDays: this.days() };
  }

  isStale(): boolean {
    const d = this.days();
    if (d === 0) return false;
    const at = this.indexUpdatedAt();
    return !at || Date.now() - Date.parse(at) > d * 86_400_000;
  }

  run(trigger: 'auto' | 'manual'): boolean {
    if (this.status.running) return false;
    this.status = { ...this.status, running: true, lastStart: new Date().toISOString(), lastTrigger: trigger, log: [] };
    // usage stats first (the team sets use their spreads), then the meta teams
    const child = spawn('npx tsx scripts/ingest-smogon.ts && npx tsx scripts/ingest-teams.ts', { cwd: this.root, shell: true });
    const push = (b: Buffer) => {
      for (const line of b.toString().split(/\r?\n/)) if (line.trim()) this.status.log = [...this.status.log, line].slice(-40);
    };
    child.stdout.on('data', push);
    child.stderr.on('data', push);
    child.on('close', (code) => {
      this.status = { ...this.status, running: false, lastEnd: new Date().toISOString(), lastExit: code };
      console.log(`[updater] ingestion finished with code ${code}`);
    });
    child.on('error', (e) => {
      this.status = { ...this.status, running: false, lastEnd: new Date().toISOString(), lastExit: -1, log: [...this.status.log, String(e)] };
    });
    console.log(`[updater] ingestion started (${trigger})`);
    return true;
  }

  /** Check now and every 6 hours. */
  start() {
    const check = () => {
      if (this.isStale()) this.run('auto');
    };
    setTimeout(check, 5_000);
    this.timer = setInterval(check, 6 * 3_600_000);
    this.timer.unref();
  }
}
