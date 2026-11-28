import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { FastForward, Play, SkipForward } from 'lucide-react';
import { getSpecies, toID } from '@pch/engine';
import { spriteId } from '../lib/pokemon';
import { useApp } from '../lib/app';
import { ARENA_H, ARENA_W, arenaDataUrl } from '../lib/pixelArena';
import type { Mon, SceneState, Side } from './BattleScene';
import './battle-scene.css';

/**
 * Everything uses ONE pixel set (Showdown's gen-5 sprites) on a pixel-art arena drawn at 320×200.
 * Sizes are in container units (100cqw = 320 arena px), so sprites, background and effects share a grid.
 * New Champions Megas without a gen-5 sprite use their base Pokémon's sprite (same style).
 */
const SPR = 'https://play.pokemonshowdown.com/sprites';
function SceneSprite({ species, back }: { species: string; back: boolean }) {
  const id = spriteId(species);
  const base = toID(getSpecies(species)?.baseSpecies ?? species);
  const chain = useMemo(
    () =>
      back
        ? [{ src: `${SPR}/gen5-back/${id}.png` }, { src: `${SPR}/gen5/${id}.png`, flip: true }, { src: `${SPR}/gen5-back/${base}.png` }, { src: `${SPR}/gen5/${base}.png`, flip: true }]
        : [{ src: `${SPR}/gen5/${id}.png` }, { src: `${SPR}/gen5/${base}.png` }],
    [id, base, back],
  );
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [id, back]);
  const c = chain[i];
  if (!c) return null;
  return <img src={c.src} alt={species} draggable={false} onError={() => setI((x) => x + 1)} className="scene-sprite-img" style={{ transform: c.flip ? 'scaleX(-1)' : undefined }} />;
}

/** Feet position of each slot, in arena pixels (320×200). Matches the platforms in pixelArena. */
export function spotPx(side: Side, slot: number, doubles: boolean) {
  if (side === 'p2') return doubles ? (slot === 0 ? { x: 196, y: 97 } : { x: 260, y: 94 }) : { x: 228, y: 96 };
  return doubles ? (slot === 0 ? { x: 52, y: 206 } : { x: 128, y: 210 }) : { x: 86, y: 208 };
}
const pct = (p: { x: number; y: number }) => ({ x: (p.x / ARENA_W) * 100, y: (p.y / ARENA_H) * 100 });
/** Sprite box in arena pixels: rival 1×, yours bigger (closer to the camera). */
const spriteSize = (side: Side, doubles: boolean) => (side === 'p2' ? 96 : doubles ? 120 : 144);

function HpBox({ m, side, active }: { m: Mon; side: Side; active?: boolean }) {
  const { names } = useApp();
  const c = m.hp > 50 ? '#3ad06e' : m.hp > 20 ? '#f2c230' : '#f0523e';
  return (
    <div className={`px-hud ${m.fainted ? 'opacity-40' : ''} ${active ? 'px-hud-active' : ''}`}>
      <div className="flex items-center gap-1">
        <span className="truncate">{names.species(m.forme ?? m.species)}</span>
        {m.status && <span className={`scene-status st-${m.status}`}>{m.status.toUpperCase()}</span>}
        <span className="ml-auto opacity-70">Nv50</span>
      </div>
      <div className="px-hpbar">
        <span className="px-hp-label">PS</span>
        <div className="px-hp-track">
          <div className="px-hp-fill" style={{ width: `${m.hp}%`, background: c }} />
        </div>
      </div>
      <div className="px-hp-num">{side === 'p1' && m.hpText ? m.hpText : `${Math.round(m.hp)}%`}</div>
    </div>
  );
}

export interface SceneTargeting {
  targets: { side: Side; slot: number }[];
  onPick: (side: Side, slot: number) => void;
}

export function BattleSceneView({
  scene,
  doubles,
  speed,
  setSpeed,
  busy,
  onSkip,
  command,
  targeting,
  activeSlot,
}: {
  scene: SceneState;
  doubles: boolean;
  speed: number;
  setSpeed: (n: number) => void;
  busy: boolean;
  onSkip: () => void;
  /** When set (your turn), the bottom box shows these commands instead of the narration. */
  command?: ReactNode;
  targeting?: SceneTargeting;
  activeSlot?: number;
}) {
  const { settings } = useApp();
  const n = doubles ? 2 : 1;
  const weather = scene.weather ? `wx-${toID(scene.weather)}` : '';
  const trick = scene.fields.includes('Trick Room');
  const bg = useMemo(() => arenaDataUrl(settings.theme === 'light' ? 'day' : 'dusk'), [settings.theme]);
  const isTarget = (side: Side, slot: number) => !!targeting?.targets.some((t) => t.side === side && t.slot === slot);
  const choosing = command !== undefined && !busy;

  return (
    <div className="px-frame">
      <div className={`battle-scene ${weather} ${trick ? 'trick-room' : ''}`} style={{ backgroundImage: `url(${bg})` }}>
        {scene.weather && <div className={`scene-weather ${weather}`} />}
        {(['p1', 'p2'] as Side[]).map((side) => scene.sides[side].includes('Tailwind') && <div key={side} className={`scene-wind scene-wind-${side}`} />)}
        <div className="absolute top-[3%] left-[2%] z-20 flex flex-col gap-1">{scene.slots.p2.slice(0, n).map((m, i) => m && <HpBox key={`h2${i}`} m={m} side="p2" />)}</div>
        <div className="absolute right-[2%] bottom-[3%] z-20 flex flex-col gap-1">{scene.slots.p1.slice(0, n).map((m, i) => m && <HpBox key={`h1${i}`} m={m} side="p1" active={choosing && activeSlot === i} />)}</div>
        {(['p2', 'p1'] as Side[]).flatMap((side) =>
          scene.slots[side].slice(0, n).map((m, slot) => {
            if (!m) return null;
            const s = pct(spotPx(side, slot, doubles));
            const a = m.anim;
            const tgt = choosing && isTarget(side, slot);
            const size = spriteSize(side, doubles);
            return (
              <div
                key={`${side}${slot}`}
                className={`scene-mon scene-mon-${side} ${tgt ? 'is-targetable' : ''} ${choosing && side === 'p1' && activeSlot === slot ? 'is-choosing' : ''}`}
                style={{ left: `${s.x}%`, top: `${s.y}%`, width: `${(size / ARENA_W) * 100}cqw`, zIndex: side === 'p1' ? 12 + slot : 6 + slot }}
                onClick={tgt ? () => targeting!.onPick(side, slot) : undefined}
              >
                <div key={m.enterId} className="anim-enter-wrap">
                  <div key={a?.id} className={`scene-sprite ${a ? `anim-${a.kind} anim-${a.kind}-${side}` : ''} ${m.fainted && a?.kind !== 'faint' ? 'is-fainted' : ''}`}>
                    <SceneSprite species={m.forme ?? m.species} back={side === 'p1'} />
                    {a?.kind === 'protect' && <span className="fx-shield" />}
                    {a?.kind === 'mega' && <span className="fx-mega" />}
                    {(a?.kind === 'boost' || a?.kind === 'drop' || a?.kind === 'heal' || a?.kind === 'status') && <span className={`fx-aura fx-aura-${a.kind}`} />}
                  </div>
                </div>
                {tgt && <span className="px-target-arrow">▼</span>}
              </div>
            );
          }),
        )}
        {scene.fx &&
          scene.fx.to.map((t, k) => {
            const lift = (sd: Side) => spriteSize(sd, doubles) * 0.45;
            const a0 = spotPx(scene.fx!.from.side, scene.fx!.from.slot, doubles);
            const b0 = spotPx(t.side, t.slot, doubles);
            const a = pct({ x: a0.x, y: a0.y - lift(scene.fx!.from.side) });
            const b = pct({ x: b0.x, y: b0.y - lift(t.side) });
            return (
              <span
                key={`${scene.fx!.id}-${k}`}
                className={scene.fx!.physical ? 'fx-slash' : 'fx-orb'}
                style={{ '--c': scene.fx!.color, '--x0': `${a.x}%`, '--y0': `${a.y}%`, '--x1': `${b.x}%`, '--y1': `${b.y}%`, left: `${b.x}%`, top: `${b.y}%` } as CSSProperties}
              />
            );
          })}
        <div className="absolute top-[3%] right-[2%] z-30 flex items-center gap-1">
          {scene.turn > 0 && <span className="scene-chip">T{scene.turn}</span>}
          <button className="scene-chip" title="Velocidad de animación" onClick={() => setSpeed(speed === 1 ? 2 : 1)}>
            {speed === 1 ? <Play size={11} /> : <FastForward size={11} />} ×{speed}
          </button>
          {busy && (
            <button className="scene-chip" title="Saltar animaciones" onClick={onSkip}>
              <SkipForward size={11} />
            </button>
          )}
        </div>
      </div>
      <div className="px-box">
        {choosing ? (
          command
        ) : (
          <span key={scene.msg} className="px-text">
            {scene.msg || '…'}
          </span>
        )}
      </div>
    </div>
  );
}
