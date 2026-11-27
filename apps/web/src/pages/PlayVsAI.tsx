import { useEffect, useMemo, useRef, useState } from 'react';
import { Bot, Dices, Flag, Loader2, RotateCcw, Swords } from 'lucide-react';
import { dex, type Build } from '@pch/engine';
import { parseLog, teamState, type ParsedBattle, type Review, type Side } from '@pch/engine/battle/log';
import type { BattleOut, View } from '../workers/battle.worker';
import { useApp } from '../lib/app';
import { usePool } from '../lib/pool';
import { resolveTeam, TYPE_COLORS } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import { createBattleClient } from '../lib/battleClient';
import type { Mode } from '../lib/types';
import { Empty, ItemIcon, PageHeader, Segmented, Sprite } from '../components/ui';
import { localiseNote, TurnReview, useActionText, type AiTurnInfo } from '../components/TurnReview';

const PICK: Record<Mode, number> = { doubles: 4, singles: 3 };
const PROFILES = ['balanced', 'aggressive', 'antimeta', 'speed', 'consistency'] as const;
const DEPTH_LABEL: Record<number, string> = { 1: 'Normal', 2: 'Difícil', 3: 'Experto' };
const NEEDS_TARGET = new Set(['normal', 'any', 'adjacentFoe', 'adjacentAlly', 'adjacentAllyOrSelf']);

type Phase = 'setup' | 'preview' | 'battle' | 'over';

export default function PlayVsAI() {
  const { settings, teams, pokemon, regulation, snapshot, names, saveSettings } = useApp();
  const mode = settings.defaultMode;
  const pool = usePool(false);
  const modeTeams = teams.filter((t) => t.format === mode);
  const [teamId, setTeamId] = useState(settings.activeTeam[mode] ?? modeTeams[0]?.id ?? '');
  const [myGen, setMyGen] = useState<Build[]>();
  const saved = useMemo(() => resolveTeam(teams.find((t) => t.id === teamId), pokemon).builds, [teams, teamId, pokemon]);
  const myTeam = teamId === '__gen' || !modeTeams.length ? (myGen ?? []) : saved;
  const [botTeam, setBotTeam] = useState<Build[]>();
  const [botBusy, setBotBusy] = useState(false);
  const [depth, setDepth] = useState(2);
  const [phase, setPhase] = useState<Phase>('setup');
  const [err, setErr] = useState<string>();

  // battle state
  const client = useRef<ReturnType<typeof createBattleClient> | undefined>(undefined);
  const [view, setView] = useState<View>();
  const [lines, setLines] = useState<string[]>([]);
  const [thinking, setThinking] = useState(false);
  const [ai, setAi] = useState<Record<number, AiTurnInfo>>({});
  const [botOrder, setBotOrder] = useState<number[]>([]);
  const [review, setReview] = useState<{ parsed: ParsedBattle; review: Review }>();

  useEffect(() => () => client.current?.close(), []);

  // teams from the Squad Builder with a random objective, so every game is different
  // avoid = species of the other side (no mirror matches); a random 75% of the pool adds variety
  const genTeam = async (avoid: Build[] = []): Promise<Build[]> => {
    const s = await snapshot(mode);
    const profile = PROFILES[Math.floor(Math.random() * PROFILES.length)]!;
    const skip = new Set(avoid.map((b) => b.species));
    let sub = pool.filter((p) => !skip.has(p.build.species) && Math.random() < 0.75);
    if (sub.length < 12) sub = pool.filter((p) => !skip.has(p.build.species));
    const r = await runAnalysis<{ result: { teams: { members: number[] }[] } }>({ type: 'squad', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, pool: sub, format: mode, profile, locked: [], topN: 24 });
    const opts = r.result.teams.slice(0, 3);
    const t = opts[Math.floor(Math.random() * opts.length)];
    if (!t) throw new Error('No se pudo armar un equipo');
    return t.members.map((i) => sub[i]!.build);
  };
  // refs: generation is async, so always avoid the *latest* team and never run two at once
  const myTeamRef = useRef<Build[]>([]);
  myTeamRef.current = myTeam;
  const botRunning = useRef(false);
  const rollBot = async () => {
    if (botRunning.current) return;
    botRunning.current = true;
    setBotBusy(true);
    setErr(undefined);
    try {
      setBotTeam(await genTeam(myTeamRef.current));
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      botRunning.current = false;
      setBotBusy(false);
    }
  };
  const [myBusy, setMyBusy] = useState(false);
  const rollMine = async () => {
    setMyBusy(true);
    setErr(undefined);
    try {
      setMyGen(await genTeam(botTeam));
      setTeamId('__gen');
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setMyBusy(false);
    }
  };
  useEffect(() => {
    if (!botTeam && pool.length) rollBot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, mode]);
  // your team changed and now shares Pokémon with the AI's: give the AI a different one
  const myKey = myTeam.map((b) => b.species).join('|');
  useEffect(() => {
    if (!botTeam || phase !== 'setup') return;
    const mine = new Set(myTeam.map((b) => b.species));
    if (botTeam.filter((b) => mine.has(b.species)).length >= 2) rollBot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myKey, botTeam]);

  const onMsg = (m: BattleOut) => {
    if (m.type === 'error') return setStarting(false), setErr(m.message);
    if (m.type === 'thinking') return setThinking(m.on);
    if (m.type === 'botPreview') return setBotOrder(m.order);
    if (m.type === 'grade') return setAi((a) => ({ ...a, [m.turn]: { ...a[m.turn], botLabel: m.botLabel, botProb: m.botProb, yours: m.yours, best: m.best, bestLabel: m.bestLabel } }));
    if (m.type === 'view') {
      setStarting(false);
      setView(m.view);
      if (m.view.lines.length) setLines((l) => [...l, ...m.view.lines]);
      const bt = m.view.botTurn;
      if (bt) setAi((a) => ({ ...a, [bt.turn]: { ...a[bt.turn], botLabel: bt.label, botProb: bt.prob, strategy: bt.strategy } }));
      setPhase(m.view.phase === 'preview' ? 'preview' : m.view.phase === 'ended' ? 'over' : 'battle');
    }
  };

  const [starting, setStarting] = useState(false);
  const start = async () => {
    if (!botTeam || myTeam.length < PICK[mode]) return;
    setStarting(true);
    setErr(undefined);
    setLines([]);
    setAi({});
    setReview(undefined);
    setView(undefined);
    client.current?.close();
    client.current = createBattleClient(onMsg);
    const s = await snapshot(mode);
    client.current.send({ type: 'start', mode, me: { name: 'Tú', team: myTeam }, bot: { name: 'IA', team: botTeam }, pack: regulation.pack, snapshot: s, depth });
  };

  // post-battle review (same analysis as Showdown replays)
  useEffect(() => {
    if (phase !== 'over' || review || !lines.length) return;
    (async () => {
      const s = await snapshot(mode);
      const r = await runAnalysis<{ result: { parsed: ParsedBattle; review: Review } }>({ type: 'replay', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, log: lines.join('\n'), me: 'p1' });
      setReview(r.result);
    })().catch((e) => setErr(String(e)));
  }, [phase, review, lines, mode, regulation, snapshot]);

  const parsed = useMemo(() => (lines.length ? parseLog(lines) : undefined), [lines]);

  return (
    <div className="fade-up max-w-5xl">
      <PageHeader
        title="Jugar contra la IA"
        subtitle="Un combate completo con el motor de Pokémon Showdown. La IA calcula cada turno con teoría de juegos: mezcla sus jugadas para que no puedas leerla, y al final te enseña qué jugó y dónde pudiste hacerlo mejor."
        actions={
          phase === 'battle' ? (
            <button className="btn text-bad" onClick={() => client.current?.send({ type: 'forfeit' })}>
              <Flag size={14} /> Rendirse
            </button>
          ) : undefined
        }
      />
      {err && <div className="mb-4 rounded-lg border border-bad/40 bg-bad/10 p-3 text-sm text-bad">{err}</div>}

      {phase === 'setup' && (
        <Setup
          mode={mode}
          setMode={(m) => saveSettings({ defaultMode: m })}
          teams={modeTeams}
          teamId={teamId}
          setTeamId={setTeamId}
          myTeam={myTeam}
          rollMine={rollMine}
          myBusy={myBusy}
          hasGen={!!myGen}
          botTeam={botTeam}
          botBusy={botBusy}
          rollBot={rollBot}
          depth={depth}
          setDepth={setDepth}
          onStart={start}
          starting={starting}
        />
      )}
      {phase === 'preview' && view && botTeam && <Preview mode={mode} myTeam={myTeam} botTeam={botTeam} onConfirm={(order) => client.current?.send({ type: 'preview', order })} />}
      {(phase === 'battle' || phase === 'over') && view && parsed && (
        <BattleScreen view={view} parsed={parsed} thinking={thinking} ai={ai} over={phase === 'over'} onChoose={(c) => client.current?.send({ type: 'choose', choice: c })} />
      )}
      {phase === 'over' && (
        <div className="mt-5">
          <div className="mb-3 flex flex-wrap gap-2">
            <button className="btn btn-primary" onClick={start}>
              <RotateCcw size={14} /> Revancha
            </button>
            <button
              className="btn"
              onClick={() => {
                setPhase('setup');
                setBotTeam(undefined);
                rollBot();
              }}
            >
              <Dices size={14} /> Otro rival
            </button>
          </div>
          {review ? (
            <TurnReview parsed={review.parsed} review={review.review} ai={ai} />
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> Preparando el repaso turno a turno…
            </p>
          )}
        </div>
      )}
      {botOrder.length > 0 && phase === 'over' && botTeam && (
        <p className="mt-3 text-xs text-faint">
          La IA llevó: {botOrder.map((i) => names.species(botTeam[i]?.species)).join(', ')}.
        </p>
      )}
    </div>
  );
}

function TeamRow({ team, size = 40 }: { team: Build[]; size?: number }) {
  const { names } = useApp();
  return (
    <div className="flex flex-wrap gap-2">
      {team.map((b, i) => (
        <div key={i} className="flex items-center gap-1.5 rounded-lg bg-panel-2 px-2 py-1" title={`${names.species(b.species)} @ ${names.item(b.item)} · ${b.moves.map(names.move).join(', ')}`}>
          <Sprite species={b.species} size={size} kind="icon" />
          <div className="text-xs leading-tight">
            <div className="font-medium">{names.species(b.species)}</div>
            <div className="flex items-center gap-1 text-faint">
              <ItemIcon item={b.item} /> {names.item(b.item)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function Setup(p: {
  mode: Mode;
  setMode: (m: Mode) => void;
  teams: { id: string; name: string }[];
  teamId: string;
  setTeamId: (s: string) => void;
  myTeam: Build[];
  rollMine: () => void;
  myBusy: boolean;
  hasGen: boolean;
  botTeam?: Build[];
  botBusy: boolean;
  rollBot: () => void;
  depth: number;
  setDepth: (n: number) => void;
  onStart: () => void;
  starting: boolean;
}) {
  const ok = p.myTeam.length >= PICK[p.mode] && !!p.botTeam && !p.botBusy && !p.myBusy && !p.starting;
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="panel-title">Tu equipo</span>
          <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'doubles', label: 'Dobles (elige 4)' }, { value: 'singles', label: 'Individuales (elige 3)' }]} />
          {p.teams.length > 0 && (
            <select className="input w-56 py-1" value={p.teamId} onChange={(e) => p.setTeamId(e.target.value)}>
              {p.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {p.hasGen && <option value="__gen">Equipo generado</option>}
            </select>
          )}
          <button className="btn text-xs" onClick={p.rollMine} disabled={p.myBusy}>
            {p.myBusy ? <Loader2 size={13} className="animate-spin" /> : <Dices size={13} />} {p.teams.length ? 'Usar uno generado' : 'Arma uno por mí'}
          </button>
        </div>
        {p.myTeam.length ? (
          <TeamRow team={p.myTeam} />
        ) : (
          <Empty>
            No tienes equipos de {p.mode === 'doubles' ? 'dobles' : 'individuales'}. Pulsa «Arma uno por mí» para jugar ya con un equipo del meta, o crea el tuyo en <a className="text-accent underline" href="#/squad">Squad Builder</a>.
          </Empty>
        )}
        {p.myTeam.length > 0 && p.myTeam.length < PICK[p.mode] && <p className="mt-2 text-sm text-warn">Tu equipo necesita al menos {PICK[p.mode]} Pokémon.</p>}
      </div>
      <div className="panel p-4">
        <div className="mb-2 flex flex-wrap items-center gap-3">
          <span className="panel-title flex items-center gap-1.5">
            <Bot size={14} /> Equipo de la IA
          </span>
          <button className="btn text-xs" onClick={p.rollBot} disabled={p.botBusy}>
            {p.botBusy ? <Loader2 size={13} className="animate-spin" /> : <Dices size={13} />} Otro equipo
          </button>
          <span className="text-[11px] text-faint">Armado por el Squad Builder con los Pokémon del meta. Hojas de equipo abiertas, como en Reg M-C.</span>
        </div>
        {p.botTeam ? <TeamRow team={p.botTeam} /> : <p className="text-sm text-muted">Armando un equipo…</p>}
      </div>
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <span className="panel-title">Dificultad</span>
        <Segmented value={String(p.depth)} onChange={(v) => p.setDepth(Number(v))} options={[1, 2, 3].map((d) => ({ value: String(d), label: DEPTH_LABEL[d]! }))} />
        <span className="text-[11px] text-faint">Más difícil = la IA prueba más jugadas por turno (tarda un poco más).</span>
        <button className="btn btn-primary ml-auto" disabled={!ok} onClick={p.onStart}>
          {p.starting ? <Loader2 size={15} className="animate-spin" /> : <Swords size={15} />} {p.starting ? 'Cargando el motor de combate…' : p.botBusy || p.myBusy ? 'Armando equipos…' : 'Empezar combate'}
        </button>
      </div>
    </div>
  );
}

function Preview({ mode, myTeam, botTeam, onConfirm }: { mode: Mode; myTeam: Build[]; botTeam: Build[]; onConfirm: (order: number[]) => void }) {
  const { names } = useApp();
  const [order, setOrder] = useState<number[]>([]);
  const n = PICK[mode];
  const leads = mode === 'doubles' ? 2 : 1;
  const toggle = (i: number) => setOrder((o) => (o.includes(i) ? o.filter((x) => x !== i) : o.length < n ? [...o, i] : o));
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="panel-title mb-2">La IA trae</div>
        <TeamRow team={botTeam} size={34} />
      </div>
      <div className="panel p-4">
        <div className="mb-2 flex items-center gap-2">
          <span className="panel-title">
            Elige {n} en orden: los {leads === 2 ? 'dos primeros salen' : 'primero sale'} al campo
          </span>
          <span className="num text-xs text-muted">
            {order.length}/{n}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {myTeam.map((b, i) => {
            const pos = order.indexOf(i);
            return (
              <button key={i} onClick={() => toggle(i)} className={`flex items-center gap-2 rounded-lg border p-2 text-left ${pos >= 0 ? 'border-accent bg-accent/10' : 'border-line'}`}>
                <Sprite species={b.species} size={40} kind="icon" />
                <span className="min-w-0 flex-1 text-sm">
                  <span className="block truncate font-medium">{names.species(b.species)}</span>
                  <span className="block truncate text-[11px] text-faint">{names.item(b.item)}</span>
                </span>
                {pos >= 0 && <span className="chip">{pos < leads ? `Sale ${pos + 1}` : `Atrás ${pos - leads + 1}`}</span>}
              </button>
            );
          })}
        </div>
        <button className="btn btn-primary mt-3" disabled={order.length !== n} onClick={() => onConfirm(order)}>
          Confirmar
        </button>
      </div>
    </div>
  );
}

function HpBar({ hp }: { hp: number }) {
  const c = hp > 50 ? 'bg-good' : hp > 20 ? 'bg-warn' : 'bg-bad';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
      <div className={`h-full ${c} transition-all duration-500`} style={{ width: `${Math.max(0, hp)}%` }} />
    </div>
  );
}

function MonCard({ species, hp, status, forme }: { species: string; hp: number; status?: string; forme?: string }) {
  const { names } = useApp();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl bg-panel-2/60 p-2">
      <Sprite species={forme ?? species} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 text-sm font-semibold">
          <span className="truncate">{names.species(forme ?? species)}</span>
          {status && <span className="chip px-1 py-0 text-[10px] uppercase">{status}</span>}
        </div>
        <HpBar hp={hp} />
        <div className="num mt-0.5 text-[11px] text-muted">{Math.round(hp)}%</div>
      </div>
    </div>
  );
}

function BattleScreen({ view, parsed, thinking, ai, over, onChoose }: { view: View; parsed: ParsedBattle; thinking: boolean; ai: Record<number, AiTurnInfo>; over: boolean; onChoose: (c: string) => void }) {
  const { names } = useApp();
  const text = useActionText();
  const last = parsed.turns.at(-1);
  const act = (s: Side) => (last?.activeEnd[s] ?? []).filter(Boolean) as { species: string; hp: number; status?: string; fainted: boolean }[];
  const bench = (s: Side) => {
    const st = teamState(parsed, s);
    const onField = new Set(act(s).map((m) => m.species));
    return parsed.brought[s].filter((x) => !onField.has(x)).map((x) => st[x] ?? { species: x, hp: 100, fainted: false });
  };
  const field = [parsed.field.weather, ...parsed.field.fields, ...parsed.field.sides.p1.map((x) => `Tú: ${x}`), ...parsed.field.sides.p2.map((x) => `IA: ${x}`)].filter(Boolean) as string[];
  const recent = parsed.turns.slice(-2).flatMap((t) => t.actions.map((a) => ({ t: t.turn, a })));
  const lastBot = ai[view.turn - 1];

  return (
    <div className="space-y-3">
      <div className="panel p-3">
        <div className="mb-2 flex items-center gap-2 text-xs text-muted">
          <Bot size={14} /> IA {bench('p2').length > 0 && <span className="flex gap-0.5">{bench('p2').map((m) => <Sprite key={m.species} species={m.species} size={22} kind="icon" className={m.fainted ? 'opacity-30 grayscale' : ''} />)}</span>}
          <span className="ml-auto num">Turno {view.turn}</span>
        </div>
        <div className="flex gap-2">
          {act('p2').map((m, i) => (
            <MonCard key={i} species={m.species} hp={m.hp} status={m.status} forme={parsed.forme.p2[m.species]} />
          ))}
        </div>
        {field.length > 0 && (
          <div className="my-2 flex flex-wrap gap-1">
            {field.map((f) => (
              <span key={f} className="chip text-[10px]">
                {f}
              </span>
            ))}
          </div>
        )}
        <div className="mt-2 flex gap-2">
          {act('p1').map((m, i) => (
            <MonCard key={i} species={m.species} hp={m.hp} status={m.status} forme={parsed.forme.p1[m.species]} />
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2 text-xs text-muted">
          Tú {bench('p1').length > 0 && <span className="flex gap-0.5">{bench('p1').map((m) => <Sprite key={m.species} species={m.species} size={22} kind="icon" className={m.fainted ? 'opacity-30 grayscale' : ''} />)}</span>}
        </div>
      </div>

      {!over && (thinking || view.phase === 'wait' ? (
        <div className="panel flex items-center gap-2 p-4 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> La IA está pensando…
        </div>
      ) : (
        <ActionPanel view={view} parsed={parsed} onChoose={onChoose} />
      ))}

      {over && (
        <div className={`panel p-4 text-center font-display text-2xl font-bold ${view.winner === 'Tú' ? 'text-good' : 'text-bad'}`}>{view.winner === 'Tú' ? '¡Ganaste!' : view.winner ? 'Ganó la IA' : 'Empate'}</div>
      )}

      <div className="panel p-3 text-sm">
        <div className="panel-title mb-1.5">Último turno</div>
        {recent.length ? (
          recent.map(({ t, a }, i) => (
            <p key={i} className={a.side === 'p1' ? '' : 'text-muted'}>
              <span className="num mr-1.5 text-[10px] text-faint">T{t}</span>
              {text(a)}
            </p>
          ))
        ) : (
          <p className="text-muted">¡Empieza el combate!</p>
        )}
        {lastBot?.strategy && lastBot.strategy.length > 1 && (
          <p className="mt-2 text-xs text-faint">
            La IA jugó «{localiseNote(lastBot.botLabel, names)}» ({Math.round(lastBot.botProb * 100)}%). Su mezcla: {lastBot.strategy.slice(0, 3).map((s) => `${Math.round(s.prob * 100)}% ${localiseNote(s.label, names)}`).join(' · ')}
          </p>
        )}
      </div>
      <p className="text-[11px] text-faint">La IA no ve tu jugada ni tus Stat Points reales (supone los más usados del meta). Ve tus movimientos, objetos y habilidades porque Reg M-C se juega con hojas de equipo abiertas.</p>
    </div>
  );
}

function ActionPanel({ view, parsed, onChoose }: { view: View; parsed: ParsedBattle; onChoose: (c: string) => void }) {
  const { names } = useApp();
  const doubles = parsed.gameType === 'doubles';
  const actives = view.team.filter((p) => p.active);
  const benchIdx = view.team.map((p, i) => ({ p, i })).filter(({ p }) => !p.active && !p.condition.endsWith('fnt'));
  const foes = (parsed.turns.at(-1)?.activeEnd.p2 ?? []).map((m) => m && !m.fainted ? m.species : null);
  const slots = view.phase === 'switch' ? view.forceSwitch.length : view.active.length;
  const [picks, setPicks] = useState<(string | undefined)[]>([]);
  const [labels, setLabels] = useState<(string | undefined)[]>([]);
  const [pendingMove, setPendingMove] = useState<{ slot: number; j: number }>();
  const [mega, setMega] = useState<number>(-1);
  useEffect(() => {
    setPicks([]);
    setLabels([]);
    setPendingMove(undefined);
    setMega(-1);
  }, [view]);

  const needed = Array.from({ length: slots }, (_, s) => {
    if (view.phase === 'switch') return !!view.forceSwitch[s];
    return !(actives[s]?.condition.endsWith('fnt') ?? true);
  });
  const set = (s: number, choice: string, label: string) => {
    setPicks((p) => Object.assign([...p], { [s]: choice }));
    setLabels((l) => Object.assign([...l], { [s]: label }));
    setPendingMove(undefined);
  };
  const ready = needed.every((n, s) => !n || picks[s]);
  const submit = () => {
    const parts = needed.map((n, s) => (!n ? 'pass' : picks[s]!.replace(' mega', '') + (mega === s && !picks[s]!.startsWith('switch') ? ' mega' : '')));
    onChoose(parts.join(', '));
  };

  return (
    <div className="panel p-3">
      {Array.from({ length: slots }, (_, s) => {
        if (!needed[s]) return null;
        const me = view.phase === 'switch' ? undefined : actives[s];
        const a = view.active[s];
        return (
          <div key={s} className="mb-3 last:mb-0">
            <div className="mb-1.5 flex items-center gap-2 text-sm font-semibold">
              {me ? (
                <>
                  <Sprite species={me.species} size={26} kind="icon" /> {names.species(me.species)}
                  <span className="num text-xs font-normal text-muted">{me.condition.split(' ')[0]}</span>
                </>
              ) : (
                'Elige quién entra'
              )}
              {labels[s] && <span className="chip ml-auto text-accent">{labels[s]}</span>}
            </div>
            {view.phase === 'move' && a && (
              <>
                <div className="grid grid-cols-2 gap-1.5">
                  {a.moves.map((m, j) => {
                    const mv = dex.moves.get(m.move);
                    const col = TYPE_COLORS[mv.type] ?? '#888';
                    const sel = picks[s]?.startsWith(`move ${j + 1}`);
                    return (
                      <button
                        key={j}
                        disabled={m.disabled || m.pp <= 0}
                        onClick={() => {
                          const target = doubles && NEEDS_TARGET.has(m.target);
                          if (!target) set(s, `move ${j + 1}`, names.move(m.move));
                          else setPendingMove({ slot: s, j });
                        }}
                        className={`rounded-lg border px-2 py-1.5 text-left text-sm disabled:opacity-40 ${sel ? 'ring-2 ring-accent' : ''}`}
                        style={{ borderColor: col, background: `${col}22` }}
                      >
                        <span className="block font-medium">{names.move(m.move)}</span>
                        <span className="text-[10px] text-muted">
                          {names.type(mv.type)} · {mv.category === 'Status' ? 'Estado' : `${mv.basePower || '—'} pot.`} · PP {m.pp}/{m.maxpp}
                        </span>
                      </button>
                    );
                  })}
                </div>
                {pendingMove?.slot === s && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm">
                    <span className="text-muted">¿A quién?</span>
                    {(() => {
                      const m = a.moves[pendingMove.j]!;
                      const allyT = s === 0 ? -2 : -1;
                      const opts: { t: number; label: string }[] = m.target === 'adjacentAlly' || m.target === 'adjacentAllyOrSelf' ? [{ t: allyT, label: 'Aliado' }] : foes.map((f, k) => (f ? { t: k + 1, label: names.species(f) } : null)).filter(Boolean) as { t: number; label: string }[];
                      if (m.target === 'any') opts.push({ t: allyT, label: 'Aliado' });
                      return opts.map((o) => (
                        <button key={o.t} className="btn text-xs" onClick={() => set(s, `move ${pendingMove.j + 1} ${o.t}`, `${names.move(m.move)} → ${o.label}`)}>
                          {o.label}
                        </button>
                      ));
                    })()}
                  </div>
                )}
                {a.canMegaEvo && (
                  <label className="mt-1.5 flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={mega === s} onChange={(e) => setMega(e.target.checked ? s : -1)} /> Megaevolucionar
                  </label>
                )}
              </>
            )}
            {(view.phase === 'switch' || (a && !a.trapped)) && benchIdx.length > 0 && (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {view.phase === 'move' && <span className="text-xs text-muted">Cambiar a:</span>}
                {benchIdx.map(({ p, i }) => {
                  const taken = picks.some((x, k) => k !== s && x === `switch ${i + 1}`);
                  return (
                    <button key={i} disabled={taken} className={`btn text-xs ${picks[s] === `switch ${i + 1}` ? 'ring-2 ring-accent' : ''}`} onClick={() => set(s, `switch ${i + 1}`, `Cambia a ${names.species(p.species)}`)}>
                      <Sprite species={p.species} size={20} kind="icon" /> {names.species(p.species)} <span className="num text-faint">{p.condition.split(' ')[0]}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
      <button className="btn btn-primary w-full" disabled={!ready} onClick={submit}>
        Confirmar jugada
      </button>
    </div>
  );
}
