import { useEffect, useRef, useState } from 'react';

import { dex, getSpecies } from '@pch/engine';
import { TYPE_COLORS } from '../lib/pokemon';
import { useApp } from '../lib/app';
import './battle-scene.css';

/**
 * Animated battle scene. It replays the engine's protocol lines one by one (player-1 view):
 * a message per event, attacker lunges, type-coloured projectiles, hit flashes, HP bars that drain,
 * faints, switch-ins, Mega Evolution, weather and field effects. Our own look, Showdown's sprites.
 */
export type Side = 'p1' | 'p2';
export interface Mon {
  species: string;
  forme?: string;
  hp: number; // 0-100
  hpText?: string; // exact "a/b" for your own Pokémon
  status?: string;
  fainted?: boolean;
  enterId: number;
  anim?: { kind: Anim; id: number };
}
type Anim = 'attack' | 'special' | 'hit' | 'faint' | 'enter' | 'mega' | 'protect' | 'boost' | 'drop' | 'heal' | 'status';
interface Fx {
  id: number;
  from: { side: Side; slot: number };
  to: { side: Side; slot: number }[];
  color: string;
  physical: boolean;
}
export interface SceneState {
  slots: Record<Side, (Mon | null)[]>;
  msg: string;
  turn: number;
  weather?: string;
  fields: string[];
  sides: Record<Side, string[]>;
  fx?: Fx;
}
const EMPTY: SceneState = { slots: { p1: [null, null], p2: [null, null] }, msg: '', turn: 0, fields: [], sides: { p1: [], p2: [] } };

const STAT_ES: Record<string, string> = { atk: 'el Ataque', def: 'la Defensa', spa: 'el Ataque Especial', spd: 'la Defensa Especial', spe: 'la Velocidad', accuracy: 'la Precisión', evasion: 'la Evasión' };
const STATUS_MSG: Record<string, string> = { brn: 'sufre quemaduras', par: 'está paralizado', slp: 'se quedó dormido', frz: 'quedó congelado', psn: 'fue envenenado', tox: 'fue gravemente envenenado' };
const WEATHER_MSG: Record<string, string> = {
  RainDance: '¡Empezó a llover!',
  SunnyDay: '¡El sol pega con fuerza!',
  Sandstorm: '¡Se levantó una tormenta de arena!',
  Snowscape: '¡Empezó a nevar!',
  Hail: '¡Empezó a granizar!',
  DesolateLand: '¡El sol se volvió abrasador!',
  PrimordialSea: '¡Empezó a diluviar!',
  none: 'El tiempo volvió a la normalidad.',
};
const SIDE_ES: Record<string, string> = { Tailwind: 'Viento Afín', Reflect: 'Reflejo', 'Light Screen': 'Pantalla de Luz', 'Aurora Veil': 'Velo Aurora', 'Stealth Rock': 'Trampa Rocas', Spikes: 'Púas', 'Toxic Spikes': 'Púas Tóxicas', 'Sticky Web': 'Red Viscosa', Safeguard: 'Velo Sagrado', Mist: 'Neblina' };
const FIELD_ES: Record<string, string> = { 'Trick Room': 'Espacio Raro', 'Electric Terrain': 'Campo Eléctrico', 'Grassy Terrain': 'Campo de Hierba', 'Misty Terrain': 'Campo de Niebla', 'Psychic Terrain': 'Campo Psíquico', Gravity: 'Gravedad', 'Magic Room': 'Zona Mágica', 'Wonder Room': 'Zona Extraña' };

const details = (d: string) => d.split(',')[0]!.trim();
const baseSp = (forme: string) => {
  const s = getSpecies(forme);
  return s && (s.isMega || s.battleOnly) ? (s.baseSpecies ?? forme) : forme;
};
function hpOf(s: string): { hp: number; text?: string; status?: string; fainted: boolean } {
  const [frac, status] = (s ?? '').trim().split(' ');
  if (!frac || frac === '0' || status === 'fnt') return { hp: 0, fainted: true };
  const [a, b] = frac.split('/').map(Number);
  return { hp: b ? Math.max(0, Math.min(100, (100 * a!) / b)) : Number(a), text: b && b !== 100 ? frac : undefined, status: status && status !== 'fnt' ? status : undefined, fainted: false };
}
const who = (id: string) => {
  const m = /^(p[12])([ab])?: ?(.*)$/.exec((id ?? '').trim());
  return m ? { side: m[1] as Side, slot: m[2] === 'b' ? 1 : 0, nick: m[3]! } : undefined;
};

let animSeq = 0;
const bump = (m: Mon, kind: Anim): Mon => ({ ...m, anim: { kind, id: ++animSeq } });

/** One protocol line → new scene + how long to show it (ms at ×1). */
function apply(s: SceneState, line: string, N: ReturnType<typeof useApp>['names']): [SceneState, number] {
  const p = line.split('|').slice(1);
  const cmd = p[0];
  const name = (side: Side, sp: string) => (side === 'p2' ? `${N.species(sp)} rival` : N.species(sp));
  const get = (id: string) => {
    const w = who(id);
    if (!w) return undefined;
    const m = s.slots[w.side][w.slot];
    return { ...w, m };
  };
  const setMon = (side: Side, slot: number, m: Mon | null): SceneState => {
    const arr = [...s.slots[side]];
    arr[slot] = m;
    return { ...s, slots: { ...s.slots, [side]: arr } };
  };
  const label = (w: { side: Side; m?: Mon | null; nick: string }) => name(w.side, w.m?.species ?? w.nick);

  switch (cmd) {
    case 'turn':
      return [{ ...s, turn: Number(p[1]), fx: undefined }, 250];
    case 'switch':
    case 'drag':
    case 'replace': {
      const w = who(p[1]!);
      if (!w) return [s, 0];
      const forme = details(p[2] ?? '');
      const h = hpOf(p[3] ?? '100/100');
      const m: Mon = { species: baseSp(forme), forme, hp: h.hp, hpText: h.text, status: h.status, enterId: ++animSeq, anim: { kind: 'enter', id: ++animSeq } };
      const ns = setMon(w.side, w.slot, m);
      return [{ ...ns, msg: w.side === 'p1' ? `¡Adelante, ${N.species(m.species)}!` : `La IA saca a ${N.species(m.species)}.` }, 850];
    }
    case 'detailschange': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [setMon(g.side, g.slot, { ...g.m, forme: details(p[2] ?? '') }), 0];
    }
    case '-mega': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [{ ...setMon(g.side, g.slot, bump(g.m, 'mega')), msg: `¡${label(g)} megaevolucionó!` }, 1300];
    }
    case 'move': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      const move = p[2] ?? '';
      const mv = dex.moves.get(move);
      const physical = mv.category === 'Physical';
      const targets: { side: Side; slot: number }[] = [];
      const spread = /\[spread\] ([^|]+)/.exec(line)?.[1];
      if (spread) for (const t of spread.split(',')) {
        const w = who(`${t.trim()}: x`);
        if (w) targets.push({ side: w.side, slot: w.slot });
      }
      else if (p[3]) {
        const w = who(p[3]);
        if (w && !(w.side === g.side && w.slot === g.slot)) targets.push({ side: w.side, slot: w.slot });
      }
      const missed = line.includes('[miss]') || line.includes('[still]');
      const fx = mv.category !== 'Status' && targets.length && !missed ? { id: ++animSeq, from: { side: g.side, slot: g.slot }, to: targets, color: TYPE_COLORS[mv.type] ?? '#ccc', physical } : undefined;
      const ns = setMon(g.side, g.slot, bump(g.m, physical ? 'attack' : 'special'));
      return [{ ...ns, fx, msg: `¡${label(g)} usó ${N.move(move)}!` }, 900];
    }
    case '-damage': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      const h = hpOf(p[2] ?? '');
      const from = /\[from\] (?:item: |ability: )?([^|]+)/.exec(line)?.[1];
      const m: Mon = { ...g.m, hp: h.hp, hpText: h.text ?? (g.side === 'p1' ? g.m.hpText : undefined), status: h.status ?? g.m.status };
      const ns = setMon(g.side, g.slot, from ? m : bump(m, 'hit'));
      const why = from ? (from === 'psn' || from === 'tox' ? 'el veneno' : from === 'brn' ? 'la quemadura' : from === 'Recoil' ? 'el retroceso' : from === 'Sandstorm' ? 'la tormenta de arena' : N.item(from) !== from ? N.item(from) : N.ability(from) !== from ? N.ability(from) : N.move(from)) : '';
      return [{ ...ns, msg: from ? `${label(g)} sufre daño por ${why}.` : s.msg }, from ? 900 : 750];
    }
    case '-heal':
    case '-sethp': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      const h = hpOf(p[2] ?? '');
      const ns = setMon(g.side, g.slot, bump({ ...g.m, hp: h.hp, hpText: h.text ?? g.m.hpText }, 'heal'));
      return [{ ...ns, msg: `${label(g)} recuperó PS.` }, 800];
    }
    case 'faint': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [{ ...setMon(g.side, g.slot, bump({ ...g.m, hp: 0, fainted: true }, 'faint')), msg: `¡${label(g)} se debilitó!` }, 1200];
    }
    case '-supereffective':
      return [{ ...s, msg: '¡Es súper eficaz!' }, 750];
    case '-resisted':
      return [{ ...s, msg: 'No es muy eficaz…' }, 650];
    case '-crit':
      return [{ ...s, msg: '¡Un golpe crítico!' }, 750];
    case '-miss': {
      const g = p[2] ? get(p[2]) : undefined;
      return [{ ...s, fx: undefined, msg: g ? `¡${label(g)} esquivó el ataque!` : '¡El ataque falló!' }, 800];
    }
    case '-immune': {
      const g = get(p[1]!);
      return [{ ...s, fx: undefined, msg: g ? `No afecta a ${label(g)}…` : 'No tiene efecto…' }, 800];
    }
    case '-fail':
      return [{ ...s, msg: '¡Pero falló!' }, 700];
    case '-singleturn':
    case '-activate': {
      const g = get(p[1]!);
      const what = p[2] ?? '';
      if (g?.m && /Protect|Detect|Spiky Shield|King's Shield|Baneful Bunker|Silk Trap|Burning Bulwark|Obstruct/.test(what)) {
        const blocked = cmd === '-activate';
        return [{ ...setMon(g.side, g.slot, bump(g.m, 'protect')), fx: blocked ? undefined : s.fx, msg: blocked ? `¡${label(g)} se protegió!` : `¡${label(g)} se está protegiendo!` }, 800];
      }
      if (g?.m && /Rage Powder|Follow Me/.test(what)) return [{ ...s, msg: `¡${label(g)} se convirtió en el centro de atención!` }, 700];
      return [s, 0];
    }
    case '-status': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [{ ...setMon(g.side, g.slot, bump({ ...g.m, status: p[2] }, 'status')), msg: `¡${label(g)} ${STATUS_MSG[p[2] ?? ''] ?? 'cambió de estado'}!` }, 900];
    }
    case '-curestatus': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [{ ...setMon(g.side, g.slot, { ...g.m, status: undefined }), msg: `${label(g)} se recuperó.` }, 600];
    }
    case '-boost':
    case '-unboost': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      const n = Number(p[3] ?? 1);
      const up = cmd === '-boost';
      const st = STAT_ES[p[2] ?? ''] ?? p[2];
      if (n === 0) return [{ ...s, msg: `¡${st!.charAt(0).toUpperCase()}${st!.slice(1)} de ${label(g)} no puede ${up ? 'subir' : 'bajar'} más!` }, 700];
      const how = n >= 3 ? 'muchísimo' : n === 2 ? 'mucho' : '';
      return [{ ...setMon(g.side, g.slot, bump(g.m, up ? 'boost' : 'drop')), msg: `¡${up ? 'Subió' : 'Bajó'} ${how ? `${how} ` : ''}${st} de ${label(g)}!` }, 850];
    }
    case '-weather': {
      if (line.includes('[upkeep]')) return [s, 0];
      const w = p[1] === 'none' ? undefined : p[1];
      return [{ ...s, weather: w, msg: WEATHER_MSG[p[1] ?? ''] ?? `${p[1]}` }, 1000];
    }
    case '-fieldstart':
    case '-fieldend': {
      const f = (p[1] ?? '').replace('move: ', '');
      const on = cmd === '-fieldstart';
      const fields = on ? [...s.fields.filter((x) => x !== f), f] : s.fields.filter((x) => x !== f);
      const nm = FIELD_ES[f] ?? f;
      return [{ ...s, fields, msg: f === 'Trick Room' ? (on ? '¡Se retorcieron las dimensiones!' : 'Las dimensiones volvieron a la normalidad.') : on ? `¡${nm} se activó!` : `${nm} se terminó.` }, 1000];
    }
    case '-sidestart':
    case '-sideend': {
      const side = (p[1] ?? '').slice(0, 2) as Side;
      const c = (p[2] ?? '').replace('move: ', '');
      const on = cmd === '-sidestart';
      const sides = { ...s.sides, [side]: on ? [...s.sides[side].filter((x) => x !== c), c] : s.sides[side].filter((x) => x !== c) };
      const nm = SIDE_ES[c] ?? N.move(c);
      const whose = side === 'p1' ? 'tu equipo' : 'el equipo rival';
      return [{ ...s, sides, msg: on ? (c === 'Tailwind' ? `¡Sopla un Viento Afín a favor de ${whose}!` : `¡${nm} protege a ${whose}!`) : `${nm} de ${whose} se acabó.` }, 900];
    }
    case '-ability': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      return [{ ...s, msg: `[${label(g)}: ${N.ability(p[2] ?? '')}]` }, 800];
    }
    case '-item':
    case '-enditem': {
      const g = get(p[1]!);
      if (!g?.m) return [s, 0];
      const it = N.item(p[2] ?? '');
      return [{ ...s, msg: cmd === '-item' ? `${label(g)} lleva ${it}.` : line.includes('[eat]') ? `${label(g)} se comió su ${it}.` : `${label(g)} usó su ${it}.` }, 800];
    }
    case 'cant': {
      const g = get(p[1]!);
      if (!g) return [s, 0];
      const r = p[2] ?? '';
      const t = r === 'par' ? `¡${label(g)} está paralizado y no se puede mover!` : r === 'slp' ? `${label(g)} sigue dormido.` : r === 'flinch' ? `¡${label(g)} retrocedió!` : r === 'recharge' ? `${label(g)} necesita recuperarse.` : r === 'frz' ? `${label(g)} está congelado.` : `${label(g)} no puede moverse.`;
      return [{ ...s, msg: t }, 900];
    }
    case '-hitcount':
      return [{ ...s, msg: `¡Golpeó ${p[2]} veces!` }, 700];
    case '-prepare': {
      const g = get(p[1]!);
      return [{ ...s, msg: g ? `${label(g)} se está preparando…` : s.msg }, 700];
    }
    case 'win':
      return [{ ...s, fx: undefined, msg: p[1] === 'Tú' ? '¡Has ganado el combate!' : '¡La IA ha ganado el combate!' }, 400];
    default:
      return [s, 0];
  }
}

export function useScenePlayer(lines: string[]) {
  const { names } = useApp();
  const [scene, setScene] = useState<SceneState>(EMPTY);
  const [pos, setPos] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [skip, setSkip] = useState(() => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  const reduced = useRef(skip);
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  // a new battle (lines reset): start over
  useEffect(() => {
    if (lines.length < pos) {
      setScene(EMPTY);
      setPos(0);
    }
  }, [lines.length, pos]);

  useEffect(() => {
    if (pos >= lines.length) return;
    if (skip) {
      // skip: apply everything pending at once, no animation (stays on with reduced motion)
      let st = sceneRef.current;
      for (let i = pos; i < lines.length; i++) st = apply(st, lines[i]!, names)[0];
      setScene({ ...st, fx: undefined });
      setPos(lines.length);
      if (!reduced.current) setSkip(false);
      return;
    }
    const [next, ms] = apply(sceneRef.current, lines[pos]!, names);
    setScene(next);
    const t = setTimeout(() => setPos((x) => x + 1), ms / speed);
    return () => clearTimeout(t);
  }, [pos, lines, speed, names, skip]);

  return { scene, busy: pos < lines.length, speed, setSpeed, skipNow: () => setSkip(true) };
}

