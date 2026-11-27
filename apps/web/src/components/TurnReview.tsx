import { useMemo, useState } from 'react';
import { AlertTriangle, ChevronDown, CircleCheck, CircleX, Info, Shield, Target, Zap } from 'lucide-react';
import type { ActionInfo, Note, ParsedBattle, Review, Side, TurnInfo } from '@pch/engine/battle/log';
import { useApp } from '../lib/app';
import { Sprite } from './ui';

/** Extra per-turn info only available when playing against the AI. */
export interface AiTurnInfo {
  botLabel: string;
  botProb: number;
  strategy?: { label: string; prob: number }[];
  yours?: number;
  best?: number;
  bestLabel?: string;
}

const NOTE_ICON: Record<Note['severity'], typeof Info> = { good: CircleCheck, bad: CircleX, warn: AlertTriangle, info: Info };
const NOTE_CLS: Record<Note['severity'], string> = { good: 'text-good', bad: 'text-bad', warn: 'text-warn', info: 'text-muted' };

export function useActionText() {
  const { names } = useApp();
  return (a: ActionInfo) => {
    const tgt = a.target && a.target.species !== a.actor ? ` → ${names.species(a.target.species)}` : '';
    const res: string[] = [];
    if (a.missed) res.push('falla');
    if (a.immune?.length) res.push(`no afecta a ${a.immune.map(names.species).join(' ni a ')}`);
    if (a.protectedBy?.length) res.push(`${a.protectedBy.map(names.species).join(' y ')} se protege`);
    for (const d of a.dealt) if (d.side !== a.side || d.species !== a.actor) res.push(`${names.species(d.species)} −${Math.max(0, Math.round(d.before - d.after))}%`);
    if (a.crit) res.push('¡crítico!');
    if (a.superEffective) res.push('súper eficaz');
    for (const k of a.kos) res.push(`KO a ${names.species(k)}`);
    return `${names.species(a.actor)} usa ${names.move(a.move)}${tgt}${res.length ? ` · ${res.join(', ')}` : ''}`;
  };
}

/** Line chart of the estimated advantage of `me`, with the decisive turns marked. */
export function AdvantageChart({ turns, me, keyTurns, onPick }: { turns: TurnInfo[]; me: Side; keyTurns: number[]; onPick?: (turn: number) => void }) {
  const W = 640;
  const H = 150;
  const pad = 22;
  const pts = turns.map((t, i) => {
    const p = me === 'p1' ? t.winP1 : 1 - t.winP1;
    return { t: t.turn, p, x: pad + (i * (W - 2 * pad)) / Math.max(1, turns.length - 1), y: pad + (1 - p) * (H - 2 * pad) };
  });
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Ventaja estimada por turno">
      <line x1={pad} x2={W - pad} y1={H / 2} y2={H / 2} stroke="currentColor" className="text-line" strokeDasharray="4 4" />
      <text x={4} y={pad + 4} className="fill-faint text-[10px]">
        100%
      </text>
      <text x={4} y={H - pad + 4} className="fill-faint text-[10px]">
        0%
      </text>
      <path d={`${path} L${pts.at(-1)?.x ?? pad},${H - pad} L${pad},${H - pad} Z`} className="fill-accent/10" />
      <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2.2} strokeLinejoin="round" />
      {pts.map((p) => {
        const key = keyTurns.includes(p.t);
        return (
          <g key={p.t} onClick={() => onPick?.(p.t)} className={onPick ? 'cursor-pointer' : ''}>
            <circle cx={p.x} cy={p.y} r={key ? 6 : 3.5} className={key ? 'fill-bad' : 'fill-accent'} />
            {key && (
              <text x={p.x} y={p.y - 10} textAnchor="middle" className="fill-bad text-[10px] font-semibold">
                T{p.t}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function TurnReview({ parsed, review, ai }: { parsed: ParsedBattle; review: Review; ai?: Record<number, AiTurnInfo> }) {
  const { names } = useApp();
  const me = review.me;
  const foe: Side = me === 'p1' ? 'p2' : 'p1';
  const text = useActionText();
  const [open, setOpen] = useState<Set<number>>(() => new Set(review.keyTurns));
  const won = parsed.winner && parsed.winner === parsed.players[me];
  const turns = useMemo(() => parsed.turns.filter((t) => t.turn > 0 || t.events.length), [parsed]);
  const toggle = (n: number) => setOpen((s) => (s.has(n) ? (s.delete(n), new Set(s)) : new Set(s.add(n))));
  const pick = (n: number) => {
    setOpen((s) => new Set(s.add(n)));
    document.getElementById(`turn-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className={`chip ${won ? 'border-good/50 text-good' : parsed.winner ? 'border-bad/50 text-bad' : ''}`}>{won ? 'Victoria' : parsed.winner ? 'Derrota' : 'Sin terminar'}</span>
        <span className="chip">
          {parsed.players[me]} vs {parsed.players[foe]}
        </span>
        <span className="chip">KOs: {review.summary.kosFor} hechos · {review.summary.kosAgainst} recibidos</span>
        {review.summary.intoProtect > 0 && <span className="chip text-warn">{review.summary.intoProtect} ataques contra Protección</span>}
        {review.summary.missedKos > 0 && <span className="chip text-bad">{review.summary.missedKos} KOs posibles no aprovechados</span>}
      </div>

      <div className="panel mb-4 p-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="panel-title">Tu ventaja estimada, turno a turno</span>
          <span className="text-[11px] text-faint">heurística: Pokémon y vida restantes, no una probabilidad real</span>
        </div>
        <AdvantageChart turns={turns} me={me} keyTurns={review.keyTurns} onPick={pick} />
        {review.keyTurns.length > 0 && (
          <p className="mt-1 text-sm">
            <span className="text-bad">●</span> Turnos donde más perdiste:{' '}
            {review.keyTurns
              .slice()
              .sort((a, b) => a - b)
              .map((n) => (
                <button key={n} className="mx-0.5 underline decoration-dotted" onClick={() => pick(n)}>
                  T{n}
                </button>
              ))}
          </p>
        )}
      </div>

      <div className="space-y-2">
        {turns.map((t) => {
          const isOpen = open.has(t.turn);
          const key = review.keyTurns.includes(t.turn);
          const notes = t.notes[me];
          const x = ai?.[t.turn];
          const grade = x?.yours !== undefined && x.best !== undefined ? x.best - x.yours : undefined;
          return (
            <div id={`turn-${t.turn}`} key={t.turn} className={`panel overflow-hidden ${key ? 'ring-1 ring-bad/50' : ''}`}>
              <button className="flex w-full items-center gap-3 px-4 py-2.5 text-left" onClick={() => toggle(t.turn)}>
                <span className="num w-10 text-sm font-semibold">{t.turn === 0 ? 'Inicio' : `T${t.turn}`}</span>
                <span className="flex gap-0.5">
                  {(t.activeStart[me] ?? []).map((s, i) => s && <Sprite key={i} species={s.species} size={24} kind="icon" />)}
                </span>
                <span className="text-faint">vs</span>
                <span className="flex gap-0.5">
                  {(t.activeStart[foe] ?? []).map((s, i) => s && <Sprite key={i} species={s.species} size={24} kind="icon" />)}
                </span>
                <span className="ml-auto flex items-center gap-2">
                  {notes.some((n) => n.severity === 'bad') && <CircleX size={15} className="text-bad" />}
                  {notes.some((n) => n.severity === 'warn') && <AlertTriangle size={15} className="text-warn" />}
                  {grade !== undefined && grade > 0.15 && <span className="chip text-warn">mejorable</span>}
                  <span className="num text-xs text-muted">{Math.round((me === 'p1' ? t.winP1 : 1 - t.winP1) * 100)}%</span>
                  <ChevronDown size={15} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {isOpen && (
                <div className="space-y-2 border-t border-line px-4 py-3 text-sm">
                  {t.actions.length === 0 && t.events.filter((e) => e.kind === 'switch').length > 0 && (
                    <p className="text-muted">
                      Salen: {t.events.filter((e) => e.kind === 'switch').map((e) => names.species(e.species)).join(', ')}
                    </p>
                  )}
                  {t.actions.map((a, i) => (
                    <p key={i} className={a.side === me ? '' : 'text-muted'}>
                      <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${a.side === me ? 'bg-accent' : 'bg-faint'}`} />
                      {text(a)}
                    </p>
                  ))}
                  {t.events
                    .filter((e) => ['field', 'weather', 'sidestart', 'mega'].includes(e.kind))
                    .map((e, i) => (
                      <p key={`e${i}`} className="text-xs text-faint">
                        {e.kind === 'mega' ? `${names.species(e.species)} megaevoluciona` : e.text}
                      </p>
                    ))}
                  {x && (
                    <div className="rounded-lg bg-panel-2 p-2.5 text-xs">
                      <p>
                        <Zap size={12} className="mr-1 inline text-accent" />
                        La IA eligió <b>{localiseNote(x.botLabel, names)}</b> ({Math.round(x.botProb * 100)}% de las veces en esta posición)
                      </p>
                      {x.strategy && x.strategy.length > 1 && <p className="mt-1 text-faint">Su mezcla: {x.strategy.slice(0, 3).map((s) => `${Math.round(s.prob * 100)}% ${localiseNote(s.label, names)}`).join(' · ')}</p>}
                      {grade !== undefined && (
                        <p className={`mt-1 ${grade > 0.15 ? 'text-warn' : 'text-good'}`}>
                          <Target size={12} className="mr-1 inline" />
                          {grade > 0.15 ? `Había una jugada mejor contra su mezcla: ${localiseNote(x.bestLabel ?? '', names)}` : 'Tu jugada fue de las mejores contra su mezcla.'}
                        </p>
                      )}
                    </div>
                  )}
                  {notes.map((n, i) => {
                    const Icon = NOTE_ICON[n.severity];
                    return (
                      <p key={`n${i}`} className={`flex gap-1.5 ${NOTE_CLS[n.severity]}`}>
                        <Icon size={15} className="mt-0.5 shrink-0" />
                        <span>{localiseNote(n.text, names)}</span>
                      </p>
                    );
                  })}
                  {!notes.length && !x && t.turn > 0 && (
                    <p className="flex gap-1.5 text-faint">
                      <Shield size={14} className="mt-0.5" /> Nada que destacar.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Engine texts come with English species/move names: swap the ones we can translate. */
export function localiseNote(s: string, names: ReturnType<typeof useApp>['names']): string {
  return s.replace(/\b([A-Z][A-Za-z'.-]+(?: [A-Z][A-Za-z'.-]+)*)\b/g, (w) => {
    const sp = names.species(w);
    if (sp !== w) return sp;
    const mv = names.move(w);
    return mv;
  });
}
