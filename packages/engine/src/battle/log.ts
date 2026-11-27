import { calcDamage } from '../damage.js';
import { dex, getSpecies, registeredForme } from '../data/dex.js';
import { makeBuild, type Build, type StatTable } from '../build.js';
import type { Regulation } from '../rules/regulation.js';

/**
 * Reads Pokémon Showdown battle logs (public replays or our own battles against the AI) and turns them
 * into a turn-by-turn review: who did what, an estimated advantage curve, the turns that decided the game,
 * and concrete notes (attacked into Protect, double-targeted, a KO that was available and missed).
 *
 * The advantage is a HEURISTIC from remaining Pokémon and HP, not a true win probability.
 */

export type Side = 'p1' | 'p2';
export interface ActionInfo {
  side: Side;
  actor: string; // species
  move: string;
  target?: { side: Side; species: string };
  spread?: boolean;
  protectedBy?: string[]; // targets that blocked it
  missed?: boolean;
  immune?: string[]; // targets it had no effect on
  crit?: boolean;
  superEffective?: boolean;
  dealt: { side: Side; species: string; before: number; after: number }[];
  kos: string[];
}
export interface TurnEvent {
  kind: 'switch' | 'move' | 'faint' | 'mega' | 'weather' | 'field' | 'sidestart' | 'sideend' | 'status' | 'boost' | 'item' | 'ability' | 'cant' | 'heal' | 'damage' | 'other';
  side?: Side;
  species?: string;
  text: string; // English names; the UI translates
  data?: Record<string, string | number>;
}
export interface MonSnapshot {
  species: string;
  hp: number; // 0-100
  fainted: boolean;
  status?: string;
}
export interface TurnInfo {
  turn: number; // 0 = leads
  events: TurnEvent[];
  actions: ActionInfo[];
  activeStart: Record<Side, (MonSnapshot | null)[]>;
  activeEnd: Record<Side, (MonSnapshot | null)[]>;
  kos: { side: Side; species: string }[];
  advantage: number; // p1 point of view, −1…1, end of turn
  winP1: number; // heuristic, 0-1
  notes: Record<Side, Note[]>;
}
export interface Note {
  kind: 'missed-ko' | 'into-protect' | 'double-target' | 'lost' | 'ko' | 'speed' | 'info';
  text: string;
  severity: 'good' | 'bad' | 'warn' | 'info';
}
export interface ParsedBattle {
  format: string;
  gameType: 'singles' | 'doubles';
  players: Record<Side, string>;
  winner?: string;
  teamSize: Record<Side, number>;
  preview: Record<Side, string[]>; // team preview species
  brought: Record<Side, string[]>; // seen on the field
  revealed: Record<Side, Record<string, { moves: string[]; item?: string; ability?: string; mega?: string }>>;
  turns: TurnInfo[];
  /** Field at the end of the log: weather, terrains/Trick Room, side conditions (Tailwind, screens…). */
  field: { weather?: string; fields: string[]; sides: Record<Side, string[]> };
  /** Forme currently shown on the field (e.g. "Gardevoir-Mega") by base species. */
  forme: Record<Side, Record<string, string>>;
}

const speciesFromDetails = (d: string) => d.split(',')[0]!.trim();
const baseOf = (forme: string) => registeredForme(forme);
function parseHP(s: string): { hp: number; status?: string; fainted: boolean } {
  const [frac, status] = s.trim().split(' ');
  if (!frac || frac === '0' || status === 'fnt') return { hp: 0, fainted: true };
  const [a, b] = frac.split('/').map(Number);
  const hp = b ? Math.max(0, Math.min(100, (100 * a!) / b)) : Number(a);
  return { hp, status, fainted: hp <= 0 };
}

export function parseLog(raw: string | string[]): ParsedBattle {
  const lines = (Array.isArray(raw) ? raw : raw.split('\n')).map((l) => l.trimEnd()).filter((l) => l.startsWith('|'));
  const pb: ParsedBattle = {
    format: '',
    gameType: 'doubles',
    players: { p1: 'Jugador 1', p2: 'Jugador 2' },
    teamSize: { p1: 4, p2: 4 },
    preview: { p1: [], p2: [] },
    brought: { p1: [], p2: [] },
    revealed: { p1: {}, p2: {} },
    turns: [],
    field: { fields: [], sides: { p1: [], p2: [] } },
    forme: { p1: {}, p2: {} },
  };
  // identity: "p1a: Nick" → species. Nicknames are per side.
  const nick: Record<Side, Record<string, string>> = { p1: {}, p2: {} };
  const hp: Record<Side, Record<string, MonSnapshot>> = { p1: {}, p2: {} };
  const active: Record<Side, (string | null)[]> = { p1: [null, null], p2: [null, null] };
  const ident = (id: string) => {
    const m = /^(p[12])([ab])?: ?(.*)$/.exec(id.trim());
    if (!m) return undefined;
    const side = m[1] as Side;
    const species = nick[side][m[3]!] ?? m[3]!;
    return { side, slot: m[2] === 'b' ? 1 : 0, species };
  };
  const rev = (side: Side, species: string) => (pb.revealed[side][species] ??= { moves: [] });
  const snapActive = () =>
    ({
      p1: active.p1.map((s) => (s ? { ...hp.p1[s]! } : null)),
      p2: active.p2.map((s) => (s ? { ...hp.p2[s]! } : null)),
    }) as Record<Side, (MonSnapshot | null)[]>;

  let cur: TurnInfo | undefined;
  const newTurn = (n: number) => {
    if (cur) {
      cur.activeEnd = snapActive();
      pb.turns.push(cur);
    }
    cur = { turn: n, events: [], actions: [], activeStart: snapActive(), activeEnd: { p1: [], p2: [] }, kos: [], advantage: 0, winP1: 0.5, notes: { p1: [], p2: [] } };
  };
  newTurn(0);
  let lastAction: ActionInfo | undefined;

  for (const line of lines) {
    const p = line.split('|').slice(1);
    const cmd = p[0];
    const t = cur!;
    switch (cmd) {
      case 'player':
        if (p[2]) pb.players[p[1] as Side] = p[2];
        break;
      case 'tier':
        pb.format = p[1] ?? '';
        break;
      case 'gametype':
        pb.gameType = p[1] === 'singles' ? 'singles' : 'doubles';
        break;
      case 'teamsize':
        pb.teamSize[p[1] as Side] = Number(p[2]) || 4;
        break;
      case 'poke':
        pb.preview[p[1] as Side].push(speciesFromDetails(p[2] ?? ''));
        break;
      case 'turn':
        newTurn(Number(p[1]));
        lastAction = undefined;
        break;
      case 'win':
        pb.winner = p[1];
        break;
      case 'switch':
      case 'drag':
      case 'replace': {
        const m = /^(p[12])([ab])?: ?(.*)$/.exec(p[1] ?? '');
        if (!m) break;
        const side = m[1] as Side;
        const species = baseOf(speciesFromDetails(p[2] ?? ''));
        nick[side][m[3]!] = species;
        const h = parseHP(p[3] ?? '100/100');
        hp[side][species] = { species, hp: h.hp, fainted: h.fainted, status: h.status };
        active[side][m[2] === 'b' ? 1 : 0] = species;
        if (!pb.brought[side].includes(species)) pb.brought[side].push(species);
        t.events.push({ kind: 'switch', side, species, text: `${species} entra` });
        break;
      }
      case 'detailschange': {
        const who = ident(p[1] ?? '');
        if (who) pb.forme[who.side][who.species] = speciesFromDetails(p[2] ?? '');
        if (who) t.events.push({ kind: 'other', side: who.side, species: who.species, text: `${who.species} cambia de forma (${speciesFromDetails(p[2] ?? '')})` });
        break;
      }
      case '-mega': {
        const who = ident(p[1] ?? '');
        if (who) {
          rev(who.side, who.species).mega = p[3];
          rev(who.side, who.species).item = p[3];
          t.events.push({ kind: 'mega', side: who.side, species: who.species, text: `${who.species} megaevoluciona`, data: { item: p[3] ?? '' } });
        }
        break;
      }
      case 'move': {
        const who = ident(p[1] ?? '');
        if (!who) break;
        const move = p[2] ?? '';
        const tgt = p[3] ? ident(p[3]) : undefined;
        const r = rev(who.side, who.species);
        if (move && !r.moves.includes(move) && !line.includes('[from]')) r.moves.push(move);
        lastAction = { side: who.side, actor: who.species, move, target: tgt ? { side: tgt.side, species: tgt.species } : undefined, spread: line.includes('[spread]'), dealt: [], kos: [], missed: line.includes('[miss]') };
        t.actions.push(lastAction);
        t.events.push({ kind: 'move', side: who.side, species: who.species, text: move, data: { target: tgt?.species ?? '' } });
        break;
      }
      case 'cant': {
        const who = ident(p[1] ?? '');
        if (who) t.events.push({ kind: 'cant', side: who.side, species: who.species, text: p[2] ?? '' });
        break;
      }
      case '-activate': {
        const who = ident(p[1] ?? '');
        const what = p[2] ?? '';
        if (who && /move: (Protect|Detect|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark|Obstruct|Max Guard)|Protect/.test(what) && lastAction && lastAction.side !== who.side) {
          (lastAction.protectedBy ??= []).push(who.species);
        }
        break;
      }
      case '-miss':
        if (lastAction) lastAction.missed = true;
        break;
      case '-immune': {
        const who = ident(p[1] ?? '');
        if (who && lastAction && lastAction.side !== who.side) (lastAction.immune ??= []).push(who.species);
        break;
      }
      case '-crit':
        if (lastAction) lastAction.crit = true;
        break;
      case '-supereffective':
        if (lastAction) lastAction.superEffective = true;
        break;
      case '-damage':
      case '-heal':
      case '-sethp': {
        const who = ident(p[1] ?? '');
        if (!who) break;
        const before = hp[who.side][who.species]?.hp ?? 100;
        const h = parseHP(p[2] ?? '');
        hp[who.side][who.species] = { species: who.species, hp: h.hp, fainted: h.fainted, status: h.status ?? hp[who.side][who.species]?.status };
        const from = line.includes('[from]');
        if (cmd === '-damage' && !from && lastAction) lastAction.dealt.push({ side: who.side, species: who.species, before, after: h.hp });
        if (cmd === '-damage' && from) t.events.push({ kind: 'damage', side: who.side, species: who.species, text: `${who.species} pierde vida (${/\[from\] ([^|]+)/.exec(line)?.[1] ?? ''})`, data: { before, after: h.hp } });
        if (cmd !== '-damage') t.events.push({ kind: 'heal', side: who.side, species: who.species, text: `${who.species} recupera vida`, data: { before, after: h.hp } });
        break;
      }
      case 'faint': {
        const who = ident(p[1] ?? '');
        if (!who) break;
        hp[who.side][who.species] = { species: who.species, hp: 0, fainted: true };
        t.kos.push({ side: who.side, species: who.species });
        if (lastAction && lastAction.dealt.some((d) => d.species === who.species && d.side === who.side)) lastAction.kos.push(who.species);
        t.events.push({ kind: 'faint', side: who.side, species: who.species, text: `${who.species} se debilita` });
        break;
      }
      case '-status': {
        const who = ident(p[1] ?? '');
        if (who) {
          if (hp[who.side][who.species]) hp[who.side][who.species]!.status = p[2];
          t.events.push({ kind: 'status', side: who.side, species: who.species, text: p[2] ?? '' });
        }
        break;
      }
      case '-curestatus': {
        const who = ident(p[1] ?? '');
        if (who && hp[who.side][who.species]) hp[who.side][who.species]!.status = undefined;
        break;
      }
      case '-boost':
      case '-unboost': {
        const who = ident(p[1] ?? '');
        if (who) t.events.push({ kind: 'boost', side: who.side, species: who.species, text: `${p[2]} ${cmd === '-boost' ? '+' : '−'}${p[3]}`, data: { stat: p[2] ?? '', n: Number(p[3]) * (cmd === '-boost' ? 1 : -1) } });
        break;
      }
      case '-weather':
        pb.field.weather = p[1] === 'none' ? undefined : p[1];
        if (!line.includes('[upkeep]')) t.events.push({ kind: 'weather', text: p[1] ?? '' });
        break;
      case '-fieldstart':
      case '-fieldend': {
        const f = (p[1] ?? '').replace('move: ', '');
        pb.field.fields = cmd === '-fieldstart' ? [...pb.field.fields.filter((x) => x !== f), f] : pb.field.fields.filter((x) => x !== f);
        t.events.push({ kind: 'field', text: `${f}${cmd === '-fieldend' ? ' termina' : ''}` });
        break;
      }
      case '-sidestart':
      case '-sideend': {
        const side = (p[1] ?? '').slice(0, 2) as Side;
        const c = (p[2] ?? '').replace('move: ', '');
        pb.field.sides[side] = cmd === '-sidestart' ? [...pb.field.sides[side].filter((x) => x !== c), c] : pb.field.sides[side].filter((x) => x !== c);
        t.events.push({ kind: cmd === '-sidestart' ? 'sidestart' : 'sideend', side, text: c });
        break;
      }
      case '-item':
      case '-enditem': {
        const who = ident(p[1] ?? '');
        if (who) {
          if (cmd === '-item' || !line.includes('[eat]')) rev(who.side, who.species).item ??= p[2];
          else rev(who.side, who.species).item ??= p[2];
          t.events.push({ kind: 'item', side: who.side, species: who.species, text: `${p[2]}${cmd === '-enditem' ? ' (consumido)' : ''}` });
        }
        break;
      }
      case '-ability': {
        const who = ident(p[1] ?? '');
        if (who) {
          if (!line.includes('[from] ability: Trace')) rev(who.side, who.species).ability ??= p[2];
          t.events.push({ kind: 'ability', side: who.side, species: who.species, text: p[2] ?? '' });
        }
        break;
      }
    }
  }
  if (cur) {
    cur.activeEnd = snapActive();
    pb.turns.push(cur);
  }
  // advantage curve
  for (const t of pb.turns) {
    const val = (side: Side) => {
      const n = pb.teamSize[side] || 4;
      let v = 0;
      const seen = Object.values(hpAt(pb, t, side));
      for (const s of seen) if (!s.fainted) v += 0.35 + 0.65 * (s.hp / 100);
      v += Math.max(0, n - seen.length) * 1; // not yet revealed: assumed healthy
      return v / n;
    };
    t.advantage = val('p1') - val('p2');
    t.winP1 = 1 / (1 + Math.exp(-5 * t.advantage));
  }
  return pb;
}

/** Every Pokémon of `side` seen so far with its latest HP (for the battle screen). */
export function teamState(pb: ParsedBattle, side: Side): Record<string, MonSnapshot> {
  const last = pb.turns.at(-1);
  return last ? hpAt(pb, last, side) : {};
}

/** HP of every Pokémon of `side` seen up to the end of turn `t` (replays the damage events). */
function hpAt(pb: ParsedBattle, upTo: TurnInfo, side: Side): Record<string, MonSnapshot> {
  const out: Record<string, MonSnapshot> = {};
  for (const t of pb.turns) {
    for (const s of [...t.activeStart[side], ...t.activeEnd[side]]) if (s) out[s.species] = s;
    for (const k of t.kos) if (k.side === side) out[k.species] = { species: k.species, hp: 0, fainted: true };
    if (t === upTo) break;
  }
  return out;
}

// ------------------------------------------------------------------ analysis

export interface SpreadGuessLite {
  alignment: string;
  sp: StatTable;
  ability?: string;
  item?: string;
}
export interface Review {
  me: Side;
  keyTurns: number[]; // turns where `me`'s estimated advantage dropped the most
  summary: { kosFor: number; kosAgainst: number; intoProtect: number; missedKos: number };
}

const PROTECT_MOVES = /^(Protect|Detect|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark|Obstruct)$/;

/**
 * Adds notes for `me` to every turn. `guess` gives the spread/ability assumed for each species
 * (from the meta); damage is the engine's exact calc with those assumptions.
 */
export function reviewBattle(pb: ParsedBattle, me: Side, reg: Regulation | undefined, guess: (species: string) => SpreadGuessLite | undefined): Review {
  const foe: Side = me === 'p1' ? 'p2' : 'p1';
  let intoProtect = 0;
  let missedKos = 0;
  const buildFor = (side: Side, species: string): Build | undefined => {
    const r = pb.revealed[side][species];
    const g = guess(species);
    const sp = getSpecies(species);
    if (!sp) return undefined;
    return makeBuild({
      species,
      ability: r?.ability ?? g?.ability ?? Object.values(sp.abilities ?? {})[0] ?? '',
      item: r?.mega ?? r?.item ?? g?.item,
      alignment: g?.alignment ?? 'Serious',
      moves: r?.moves ?? [],
      sp: g?.sp ?? { hp: 11, atk: 11, def: 11, spa: 11, spd: 11, spe: 11 },
    });
  };

  for (const t of pb.turns) {
    const notes = t.notes[me];
    const mine = t.actions.filter((a) => a.side === me);
    const theirs = t.actions.filter((a) => a.side === foe);
    // KOs both ways
    for (const k of t.kos) {
      if (k.side === foe) notes.push({ kind: 'ko', severity: 'good', text: `Debilitaste a ${k.species}.` });
      else notes.push({ kind: 'lost', severity: 'bad', text: `Perdiste a ${k.species}.` });
    }
    // attacked into Protect
    for (const a of mine) {
      if (a.protectedBy?.length && !a.spread) {
        intoProtect++;
        notes.push({ kind: 'into-protect', severity: 'warn', text: `${a.actor} usó ${a.move} contra ${a.protectedBy.join(' y ')}, que se protegió: turno perdido para ese Pokémon.` });
      }
    }
    // double-targeted and fainted
    const hitsOn = new Map<string, number>();
    for (const a of theirs) for (const d of a.dealt) if (d.side === me) hitsOn.set(d.species, (hitsOn.get(d.species) ?? 0) + 1);
    for (const [sp, n] of hitsOn) {
      if (n >= 2 && t.kos.some((k) => k.side === me && k.species === sp)) {
        const protectedThisTurn = mine.some((a) => a.actor === sp && PROTECT_MOVES.test(a.move));
        if (!protectedThisTurn)
          notes.push({ kind: 'double-target', severity: 'warn', text: `${sp} recibió dos ataques y cayó. Si era previsible, Protección o un cambio lo habrían salvado.` });
      }
    }
    // a KO that was available and not taken
    if (reg) {
      for (const a of mine) {
        if (a.kos.length || PROTECT_MOVES.test(a.move)) continue;
        const attacker = buildFor(me, a.actor);
        if (!attacker || !attacker.moves.length) continue;
        const atStart = (t.activeStart[me] ?? []).find((s) => s?.species === a.actor);
        let best: { move: string; target: string; p: number } | undefined;
        for (const f of t.activeStart[foe] ?? []) {
          if (!f || f.fainted) continue;
          const diedAnyway = t.kos.some((k) => k.side === foe && k.species === f.species);
          const protectedAll = theirs.some((x) => x.actor === f.species && PROTECT_MOVES.test(x.move));
          if (diedAnyway || protectedAll) continue;
          const defender = buildFor(foe, f.species);
          if (!defender) continue;
          for (const mv of attacker.moves) {
            const m = dex.moves.get(mv);
            if (!m?.exists || m.category === 'Status' || mv === a.move) continue;
            try {
              const r = calcDamage(attacker, defender, mv, reg, { defender: { curHPPercent: Math.max(1, f.hp) }, attacker: { curHPPercent: atStart?.hp ?? 100 } });
              const p = r.koChance[0];
              if (p >= 0.85 && (!best || p > best.p)) best = { move: mv, target: f.species, p };
            } catch {
              /* species/move the calc can't model */
            }
          }
        }
        if (best) {
          // was the chosen move itself a likely KO on that target? then it's not a miss
          const chosenWasKo = a.target?.species === best.target && a.dealt.some((d) => d.species === best!.target);
          if (!chosenWasKo) {
            missedKos++;
            notes.push({ kind: 'missed-ko', severity: 'bad', text: `${a.actor} tenía un KO casi seguro: ${best.move} sobre ${best.target} (${Math.round(best.p * 100)}% con sets probables). Usó ${a.move}.` });
          }
        }
      }
    }
  }
  // key turns: biggest drops of my advantage
  const drops = pb.turns
    .map((t, i) => {
      const prev = i ? pb.turns[i - 1]!.winP1 : 0.5;
      const d = (t.winP1 - prev) * (me === 'p1' ? 1 : -1);
      return { turn: t.turn, d };
    })
    .filter((x) => x.d < -0.04)
    .sort((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((x) => x.turn);
  const kosFor = pb.turns.reduce((s, t) => s + t.kos.filter((k) => k.side === foe).length, 0);
  const kosAgainst = pb.turns.reduce((s, t) => s + t.kos.filter((k) => k.side === me).length, 0);
  return { me, keyTurns: drops, summary: { kosFor, kosAgainst, intoProtect, missedKos } };
}
