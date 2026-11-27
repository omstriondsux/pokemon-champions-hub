import type { BattleIn, BattleOut } from '../workers/battle.worker';

/** One battle worker per page visit; the Showdown engine is only downloaded when you open "Contra la IA". */
export function createBattleClient(onMessage: (m: BattleOut) => void) {
  const w = new Worker(new URL('../workers/battle.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (e: MessageEvent<BattleOut>) => onMessage(e.data);
  w.onerror = (e) => onMessage({ type: 'error', message: e.message || 'Error en el motor de combate' });
  return {
    send: (m: BattleIn) => w.postMessage(m),
    close: () => w.terminate(),
  };
}
