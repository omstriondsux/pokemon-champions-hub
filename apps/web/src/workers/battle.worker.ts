/// <reference lib="webworker" />
import { adviseSelection, opponentModel, parseSpread, Regulation, type Build, type MetaSnapshot, type RegulationPack } from '@pch/engine';
import { decide, gradeChoice, newBattle, PICK, restore, type BattleMode, type BotDecision, type SpreadGuess } from '@pch/engine/battle';
import type { Battle } from '@pkmn/sim';

/**
 * A battle against the AI, entirely in this worker: Showdown's engine runs the game, the bot decides
 * for player 2. The human is always player 1 and only receives what player 1 may see
 * (own exact HP, rival HP as %), plus the bot's reasoning once a turn is over.
 */
export type BattleIn =
  | { type: 'start'; mode: BattleMode; me: { name: string; team: Build[] }; bot: { name: string; team: Build[] }; pack: RegulationPack; snapshot?: MetaSnapshot; depth: number }
  | { type: 'preview'; order: number[] }
  | { type: 'choose'; choice: string }
  | { type: 'forfeit' };

export interface ReqMove {
  move: string;
  id: string;
  pp: number;
  maxpp: number;
  target: string;
  disabled: boolean;
}
export interface ReqActive {
  moves: ReqMove[];
  canMegaEvo: boolean;
  trapped: boolean;
}
export interface ReqMon {
  ident: string;
  species: string;
  condition: string;
  active: boolean;
  item: string;
  ability: string;
  moves: string[];
}
export interface View {
  phase: 'preview' | 'move' | 'switch' | 'wait' | 'ended';
  turn: number;
  active: ReqActive[];
  forceSwitch: boolean[];
  team: ReqMon[];
  maxChosen: number;
  lines: string[]; // new protocol lines (player-1 view) since the last view
  winner?: string;
  botTurn?: { turn: number; label: string; prob: number; strategy: { label: string; prob: number }[]; predicted: { label: string; prob: number }[]; value: number; ms: number };
}
export type BattleOut =
  | { type: 'view'; view: View }
  | { type: 'thinking'; on: boolean }
  | { type: 'grade'; turn: number; yours: number; best: number; bestLabel: string; botLabel: string; botProb: number }
  | { type: 'botPreview'; order: number[] }
  | { type: 'error'; message: string };

let battle: Battle | undefined;
let guesses: Record<string, SpreadGuess> = {};
let depth = 2;
let mode: BattleMode = 'doubles';
let readPos = 0;
const revealed = new Set<string>();
let pendingBot: BotDecision | undefined;
const post = (m: BattleOut) => (self as unknown as Worker).postMessage(m);

/** Player-1 view of the log: for "|split|p1" blocks keep the secret line (exact HP of own Pokémon). */
function takeLines(): string[] {
  if (!battle) return [];
  const log = battle.log;
  const out: string[] = [];
  for (let i = readPos; i < log.length; i++) {
    const l = log[i]!;
    if (l.startsWith('|split|')) {
      const who = l.slice(7);
      out.push(who === 'p1' ? log[i + 1]! : log[i + 2]!);
      i += 2;
      continue;
    }
    out.push(l);
  }
  readPos = log.length;
  (battle as unknown as { sentLogPos: number }).sentLogPos = log.length; // keep the engine's line limit happy
  for (const l of out) {
    const m = /^\|(?:switch|drag|replace)\|p1[ab]: [^|]*\|([^,|]+)/.exec(l);
    if (m) revealed.add(m[1]!.replace(/-Mega.*$/, ''));
  }
  return out;
}

function viewFor(lines: string[], botTurn?: View['botTurn']): View {
  const b = battle!;
  const r = (b.sides[0] as unknown as { activeRequest: any }).activeRequest;
  const phase: View['phase'] = b.ended ? 'ended' : !r || r.wait ? 'wait' : r.teamPreview ? 'preview' : r.forceSwitch ? 'switch' : 'move';
  return {
    phase,
    turn: b.turn,
    active: (r?.active ?? []).map((a: any) => ({ moves: a.moves.map((m: any) => ({ move: m.move, id: m.id, pp: m.pp, maxpp: m.maxpp, target: m.target, disabled: !!m.disabled })), canMegaEvo: !!a.canMegaEvo, trapped: !!(a.trapped || a.maybeTrapped) })),
    forceSwitch: r?.forceSwitch ?? [],
    team: (r?.side?.pokemon ?? []).map((p: any) => ({ ident: p.ident, species: String(p.details).split(',')[0], condition: p.condition, active: p.active, item: p.item, ability: p.ability ?? p.baseAbility, moves: p.moves })),
    maxChosen: r?.maxChosenTeamSize ?? PICK[mode],
    lines,
    winner: b.winner || undefined,
    botTurn,
  };
}

/** Let the bot answer whatever it has to answer right now (moves, or a forced switch only it needs). */
function botAct(): void {
  const b = battle!;
  for (let k = 0; k < 6 && !b.ended; k++) {
    const r2 = (b.sides[1] as unknown as { activeRequest: any }).activeRequest;
    const r1 = (b.sides[0] as unknown as { activeRequest: any }).activeRequest;
    if (!r2 || r2.wait) return;
    const humanPending = r1 && !r1.wait;
    const d = decide(b, 'p2', { guesses, revealed, depth });
    if (humanPending) {
      // simultaneous turn: hold the decision until the human commits (the bot never sees their choice)
      pendingBot = d;
      return;
    }
    if (!b.choose('p2', d.choice)) b.choose('p2', 'default');
  }
}

function spreadGuesses(s: MetaSnapshot | undefined): Record<string, SpreadGuess> {
  const out: Record<string, SpreadGuess> = {};
  if (!s) return out;
  for (const [name, m] of Object.entries(s.pokemon)) {
    const top = Object.entries(m.spreads).sort((a, b) => b[1] - a[1])[0];
    const g = top && parseSpread(top[0]);
    if (g) out[name.replace(/-Mega.*$/, '')] ??= g as SpreadGuess;
  }
  return out;
}

self.onmessage = async (e: MessageEvent<BattleIn>) => {
  const m = e.data;
  try {
    if (m.type === 'start') {
      mode = m.mode;
      depth = m.depth;
      guesses = spreadGuesses(m.snapshot);
      revealed.clear();
      pendingBot = undefined;
      battle = newBattle(m.mode, m.me, m.bot);
      readPos = 0;
      // the bot chooses its 4 (or 3) with the Battle Advisor against the human's team preview
      const reg = new Regulation(m.pack);
      let order = [0, 1, 2, 3, 4, 5].slice(0, PICK[m.mode]);
      try {
        const models = await Promise.all(m.me.team.map((b) => opponentModel(b.species, m.snapshot, { team: m.me.team.map((x) => x.species) })));
        const adv = adviseSelection(m.bot.team, models, reg, { format: m.mode, trickRoom: false }, m.snapshot?.meta);
        const alt = adv.alternatives[Math.floor(Math.random() * Math.min(2, adv.alternatives.length))] ?? adv.alternatives[0];
        if (alt) order = [...alt.leads, ...alt.back];
      } catch {
        /* fall back to the first Pokémon */
      }
      battle.choose('p2', `team ${order.map((i) => i + 1).join('')}`);
      post({ type: 'botPreview', order });
      post({ type: 'view', view: viewFor(takeLines()) });
      return;
    }
    if (!battle) throw new Error('No hay combate en curso');
    if (m.type === 'forfeit') {
      battle.forceWin('p2' as never);
      post({ type: 'view', view: viewFor(takeLines()) });
      return;
    }
    if (m.type === 'preview') {
      if (!battle.choose('p1', `team ${m.order.map((i) => i + 1).join('')}`)) throw new Error('Selección no válida');
    } else if (m.type === 'choose') {
      const turn = battle.turn;
      const bot = pendingBot;
      // grade the human's choice against the bot's mixed strategy, from the position before the turn
      let gradeArgs: { json: unknown; choice: string } | undefined;
      if (bot && bot.strategy.length > 1) gradeArgs = { json: (battle as unknown as { toJSON(): unknown }).toJSON(), choice: m.choice };
      if (!battle.choose('p1', m.choice)) {
        const err = (battle.sides[0] as unknown as { choice: { error: string } }).choice?.error;
        throw new Error(`Jugada no válida${err ? `: ${err}` : ''}`);
      }
      if (bot) {
        if (!battle.choose('p2', bot.choice)) battle.choose('p2', 'default');
        pendingBot = undefined;
      }
      const botTurn = bot && bot.strategy.length ? { turn, label: bot.label, prob: bot.strategy.find((s) => s.choice === bot.choice)?.prob ?? 1, strategy: bot.strategy.map((s) => ({ label: s.label, prob: s.prob })), predicted: bot.predicted, value: bot.value, ms: bot.ms } : undefined;
      post({ type: 'view', view: viewFor(takeLines(), botTurn) }); // show the turn right away
      post({ type: 'thinking', on: true });
      botAct(); // then the bot prepares its next move (or a forced switch only it has to make)
      const more = takeLines();
      if (more.length) post({ type: 'view', view: viewFor(more) });
      post({ type: 'thinking', on: false });
      if (gradeArgs && bot) {
        const pre = restore(gradeArgs.json);
        const g = gradeChoice(pre, 'p1', gradeArgs.choice, bot.strategy, { guesses });
        post({ type: 'grade', turn, ...g, botLabel: bot.label, botProb: botTurn?.prob ?? 1 });
      }
      return;
    }
    post({ type: 'thinking', on: true });
    botAct();
    post({ type: 'view', view: viewFor(takeLines()) });
    post({ type: 'thinking', on: false });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
