import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Bot, Dices, ExternalLink, Flag, Loader2, Pencil, RotateCcw, Swords, Trash2, Trophy } from 'lucide-react';
import { dex, getSpecies, makeBuild, type Build } from '@pch/engine';
import { parseLog, teamState, type ParsedBattle, type Review, type Side } from '@pch/engine/battle/log';
import type { BattleOut, View } from '../workers/battle.worker';
import { useApp } from '../lib/app';
import { usePool } from '../lib/pool';
import { resolveTeam, TYPE_COLORS } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import { createBattleClient } from '../lib/battleClient';
import { api, type MetaTeam } from '../lib/api';
import type { Mode } from '../lib/types';
import { Empty, ItemIcon, PageHeader, Segmented, Sprite } from '../components/ui';
import { localiseNote, TurnReview, type AiTurnInfo } from '../components/TurnReview';
import { TeamEditor } from '../components/TeamEditor';
import { useScenePlayer, type SceneState, type Side as SceneSide } from '../components/BattleScene';
import { BattleSceneView } from '../components/BattleSceneView';

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
  const [meta, setMeta] = useState<MetaTeam[]>();
  useEffect(() => {
    setMeta(undefined);
    api
      .metaTeams(mode)
      .then((f) => setMeta(f.teams ?? []))
      .catch(() => setMeta([]));
  }, [mode]);

  // Each side: one of your teams, a real meta team, or a custom team you edit (kept in this browser).
  const [mySide, setMySide] = useSideState('me', mode, settings.activeTeam[mode] ?? modeTeams[0]?.id);
  const [botSide, setBotSide] = useSideState('bot', mode);
  const buildsOf = (st: SideState): Build[] =>
    st.source === 'mine' ? resolveTeam(teams.find((t) => t.id === st.teamId), pokemon).builds : st.source === 'meta' ? (meta?.find((t) => t.id === st.metaId)?.members.map((m) => makeBuild(m)) ?? []) : st.custom;
  const myTeam = useMemo(() => buildsOf(mySide), [mySide, teams, pokemon, meta]); // eslint-disable-line react-hooks/exhaustive-deps
  const botTeam = useMemo(() => buildsOf(botSide), [botSide, teams, pokemon, meta]); // eslint-disable-line react-hooks/exhaustive-deps

  /** A real meta team, weighted by how often it was seen; never the exact team on the other side. */
  const randomMeta = (avoid?: string): MetaTeam | undefined => {
    const list = (meta ?? []).filter((t) => t.id !== avoid);
    if (!list.length) return undefined;
    const w = list.map((t) => Math.sqrt(t.seen) + 1);
    let x = Math.random() * w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < list.length; i++) if ((x -= w[i]!) <= 0) return list[i];
    return list[0];
  };
  // first visit: the AI gets a meta team; you get your active team, or a meta team if you have none
  useEffect(() => {
    if (!meta?.length) return;
    if (botSide.source === 'meta' && !meta.some((t) => t.id === botSide.metaId)) setBotSide({ ...botSide, metaId: randomMeta(mySide.metaId)?.id });
    if (mySide.source === 'mine' && !modeTeams.some((t) => t.id === mySide.teamId)) setMySide({ ...mySide, source: 'meta', metaId: randomMeta(botSide.metaId)?.id });
    if (mySide.source === 'meta' && !meta.some((t) => t.id === mySide.metaId)) setMySide({ ...mySide, metaId: randomMeta(botSide.metaId)?.id });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, mode]);

  const [genBusy, setGenBusy] = useState(false);
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

  /** Squad Builder team with a random objective (used by "Generar uno automático"). */
  const genTeam = async (avoid: Build[] = []): Promise<Build[]> => {
    setGenBusy(true);
    try {
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
    } finally {
      setGenBusy(false);
    }
  };
  const rerollBot = () => setBotSide({ ...botSide, source: 'meta', metaId: randomMeta(mySide.source === 'meta' ? mySide.metaId : undefined)?.id });

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
    if (botTeam.length < PICK[mode] || myTeam.length < PICK[mode]) return;
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
          me={
            <TeamPicker
              title="Tu equipo"
              mode={mode}
              state={mySide}
              setState={setMySide}
              builds={myTeam}
              myTeams={modeTeams}
              meta={meta}
              onGenerate={() => genTeam(botTeam)}
              genBusy={genBusy}
              onRandomMeta={() => setMySide({ ...mySide, source: 'meta', metaId: randomMeta(botSide.source === 'meta' ? botSide.metaId : undefined)?.id })}
            />
          }
          bot={
            <TeamPicker
              title={
                <>
                  <Bot size={14} /> Equipo de la IA
                </>
              }
              mode={mode}
              state={botSide}
              setState={setBotSide}
              builds={botTeam}
              myTeams={modeTeams}
              meta={meta}
              onGenerate={() => genTeam(myTeam)}
              genBusy={genBusy}
              onRandomMeta={rerollBot}
              note="Por defecto, un equipo real de los mejores jugadores de Showdown (se actualizan cada semana). También puedes darle uno de tus equipos o armarle uno a tu gusto. Hojas de equipo abiertas, como en Reg M-C."
            />
          }
          ready={myTeam.length >= PICK[mode] && botTeam.length >= PICK[mode]}
          why={myTeam.length < PICK[mode] ? `Tu equipo necesita al menos ${PICK[mode]} Pokémon` : botTeam.length < PICK[mode] ? `El equipo de la IA necesita al menos ${PICK[mode]} Pokémon` : undefined}
          depth={depth}
          setDepth={setDepth}
          onStart={start}
          starting={starting}
        />
      )}
      {phase === 'preview' && view && <Preview mode={mode} myTeam={myTeam} botTeam={botTeam} onConfirm={(order) => client.current?.send({ type: 'preview', order })} />}
      {(phase === 'battle' || phase === 'over') && view && parsed && (
        <BattleScreen view={view} parsed={parsed} lines={lines} thinking={thinking} ai={ai} over={phase === 'over'} onChoose={(c) => client.current?.send({ type: 'choose', choice: c })} />
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
                rerollBot();
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
      {botOrder.length > 0 && phase === 'over' && (
        <p className="mt-3 text-xs text-faint">
          La IA llevó: {botOrder.map((i) => names.species(botTeam[i]?.species)).join(', ')}.
        </p>
      )}
    </div>
  );
}

/** Where a meta team comes from: rating, how often it was seen, and the public replay. */
function MetaBadge({ t }: { t: MetaTeam }) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="chip border-accent/50 text-accent">
        <Trophy size={12} /> Equipo meta real
      </span>
      <span className="chip">Rating {t.rating}</span>
      <span className="chip">
        Visto en {t.seen} {t.seen === 1 ? 'partida' : 'partidas'} del top
      </span>
      <span className="chip">{t.setsFrom === 'team-sheet' ? 'Sets exactos (hoja abierta)' : 'Sets probables'}</span>
      <a className="chip hover:text-accent" href={`https://replay.pokemonshowdown.com/${t.replay}`} target="_blank" rel="noreferrer">
        Ver replay <ExternalLink size={11} />
      </a>
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

type Source = 'mine' | 'meta' | 'custom';
interface SideState {
  source: Source;
  teamId?: string;
  metaId?: string;
  custom: Build[];
}

/** Side choice, remembered per side and mode in this browser (custom teams included). */
function useSideState(side: 'me' | 'bot', mode: Mode, teamId?: string): [SideState, (s: SideState) => void] {
  const key = `pch.play.${side}.${mode}`;
  const load = (): SideState => {
    try {
      const v = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (v && Array.isArray(v.custom)) return v;
    } catch {
      /* ignore */
    }
    return { source: side === 'me' && teamId ? 'mine' : 'meta', teamId, custom: [] };
  };
  const [st, setSt] = useState<SideState>(load);
  useEffect(() => setSt(load()), [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (s: SideState) => {
    setSt(s);
    try {
      localStorage.setItem(key, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  };
  return [st, set];
}

function TeamPicker(p: {
  title: ReactNode;
  mode: Mode;
  state: SideState;
  setState: (s: SideState) => void;
  builds: Build[];
  myTeams: { id: string; name: string }[];
  meta?: MetaTeam[];
  onGenerate: () => Promise<Build[]>;
  genBusy: boolean;
  onRandomMeta: () => void;
  note?: string;
}) {
  const { names } = useApp();
  const { state: st, setState } = p;
  const metaTeam = p.meta?.find((t) => t.id === st.metaId);
  const sources: { value: Source; label: string }[] = [
    ...(p.myTeams.length ? [{ value: 'mine' as Source, label: 'Mis equipos' }] : []),
    ...(p.meta?.length ? [{ value: 'meta' as Source, label: 'Equipo meta' }] : []),
    { value: 'custom', label: 'Personalizado' },
  ];
  const editCopy = () => setState({ ...st, source: 'custom', custom: structuredClone(p.builds) });
  const metaLabel = (t: MetaTeam, i: number) => `#${i + 1} · ${t.members.map((m) => names.species(m.species)).join(', ')} · ${t.rating}`;

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="panel-title flex items-center gap-1.5">{p.title}</span>
        <Segmented value={st.source} onChange={(source) => setState({ ...st, source, teamId: st.teamId ?? p.myTeams[0]?.id, metaId: st.metaId ?? p.meta?.[0]?.id })} options={sources} />
      </div>

      {st.source === 'mine' && (
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <select className="input w-64 py-1" value={st.teamId ?? ''} onChange={(e) => setState({ ...st, teamId: e.target.value })}>
            {p.myTeams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button className="btn text-xs" onClick={editCopy}>
            <Pencil size={13} /> Editar para este combate
          </button>
        </div>
      )}

      {st.source === 'meta' && p.meta && (
        <>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <select className="input min-w-0 flex-1 py-1 text-xs sm:text-sm" value={st.metaId ?? ''} onChange={(e) => setState({ ...st, metaId: e.target.value })}>
              {p.meta.map((t, i) => (
                <option key={t.id} value={t.id}>
                  {metaLabel(t, i)}
                </option>
              ))}
            </select>
            <button className="btn text-xs" onClick={p.onRandomMeta}>
              <Dices size={13} /> Aleatorio
            </button>
            <button className="btn text-xs" onClick={editCopy}>
              <Pencil size={13} /> Editar builds
            </button>
          </div>
          {metaTeam && <MetaBadge t={metaTeam} />}
        </>
      )}

      {st.source === 'custom' ? (
        <>
          <div className="mb-2 flex flex-wrap gap-2">
            <button className="btn text-xs" disabled={p.genBusy} onClick={async () => setState({ ...st, source: 'custom', custom: await p.onGenerate() })}>
              {p.genBusy ? <Loader2 size={13} className="animate-spin" /> : <Dices size={13} />} Generar uno automático
            </button>
            {st.custom.length > 0 && (
              <button className="btn text-xs text-bad" onClick={() => setState({ ...st, custom: [] })}>
                <Trash2 size={13} /> Vaciar
              </button>
            )}
          </div>
          <TeamEditor team={st.custom} onChange={(custom) => setState({ ...st, custom })} mode={p.mode} />
        </>
      ) : p.builds.length ? (
        <TeamRow team={p.builds} />
      ) : (
        <p className="text-sm text-muted">Cargando equipo…</p>
      )}
      {p.note && <p className="mt-2 text-[11px] text-faint">{p.note}</p>}
    </div>
  );
}

function Setup(p: {
  mode: Mode;
  setMode: (m: Mode) => void;
  me: ReactNode;
  bot: ReactNode;
  ready: boolean;
  why?: string;
  depth: number;
  setDepth: (n: number) => void;
  onStart: () => void;
  starting: boolean;
}) {
  return (
    <div className="space-y-4">
      <Segmented value={p.mode} onChange={p.setMode} options={[{ value: 'doubles', label: 'Dobles (elige 4 de 6)' }, { value: 'singles', label: 'Individuales (elige 3 de 6)' }]} />
      {p.me}
      {p.bot}
      <div className="panel flex flex-wrap items-center gap-3 p-4">
        <span className="panel-title">Dificultad</span>
        <Segmented value={String(p.depth)} onChange={(v) => p.setDepth(Number(v))} options={[1, 2, 3].map((d) => ({ value: String(d), label: DEPTH_LABEL[d]! }))} />
        <span className="text-[11px] text-faint">Más difícil = la IA prueba más jugadas por turno.</span>
        <div className="ml-auto flex items-center gap-2">
          {p.why && <span className="text-xs text-warn">{p.why}</span>}
          <button className="btn btn-primary" disabled={!p.ready || p.starting} onClick={p.onStart}>
            {p.starting ? <Loader2 size={15} className="animate-spin" /> : <Swords size={15} />} {p.starting ? 'Cargando el motor de combate…' : 'Empezar combate'}
          </button>
        </div>
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

function BattleScreen({ view, parsed, lines, thinking, ai, over, onChoose }: { view: View; parsed: ParsedBattle; lines: string[]; thinking: boolean; ai: Record<number, AiTurnInfo>; over: boolean; onChoose: (c: string) => void }) {
  const { names } = useApp();
  const { scene, busy, speed, setSpeed, skipNow } = useScenePlayer(lines);
  const lastBot = ai[view.turn - 1];
  const doubles = parsed.gameType === 'doubles';
  const ended = over && !busy;
  const yourTurn = !over && !busy && !thinking && (view.phase === 'move' || view.phase === 'switch');
  const cmd = useCommand(view, scene, doubles, onChoose, yourTurn);
  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    frameRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, []);
  const bench = (s: Side) => {
    const st = teamState(parsed, s);
    const onField = new Set((scene.slots[s] ?? []).filter(Boolean).map((m) => m!.species));
    return parsed.brought[s].filter((x) => !onField.has(x)).map((x) => st[x] ?? { species: x, hp: 100, fainted: false });
  };

  let box: ReactNode | undefined;
  if (yourTurn) box = cmd.node;
  else if (!over && !busy && (thinking || view.phase === 'wait'))
    box = (
      <span className="px-text flex items-center gap-2">
        <Loader2 size={16} className="animate-spin" /> La IA está pensando…
      </span>
    );
  else if (ended)
    box = <span className={`px-text text-center text-2xl ${view.winner === 'Tú' ? 'text-good' : 'text-bad'}`}>{view.winner === 'Tú' ? '¡Ganaste el combate!' : view.winner ? 'La IA ganó el combate.' : 'Empate.'}</span>;

  return (
    <div className="space-y-2" ref={frameRef}>
      <div className="flex items-center gap-2 text-xs text-muted">
        <Bot size={14} /> IA
        <span className="flex gap-0.5">
          {bench('p2').map((m) => (
            <Sprite key={m.species} species={m.species} size={22} kind="icon" className={m.fainted ? 'opacity-30 grayscale' : ''} />
          ))}
        </span>
        <span className="ml-auto">Tu banca</span>
        <span className="flex gap-0.5">
          {bench('p1').map((m) => (
            <Sprite key={m.species} species={m.species} size={22} kind="icon" className={m.fainted ? 'opacity-30 grayscale' : ''} />
          ))}
        </span>
      </div>
      <BattleSceneView scene={scene} doubles={doubles} speed={speed} setSpeed={setSpeed} busy={busy} onSkip={skipNow} command={box} targeting={yourTurn ? cmd.targeting : undefined} activeSlot={cmd.activeSlot} />
      {!busy && lastBot?.strategy && lastBot.strategy.length > 1 && (
        <p className="text-xs text-faint">
          <Bot size={12} className="mr-1 inline" />
          Turno {view.turn - 1}: la IA jugó «{localiseNote(lastBot.botLabel, names)}» ({Math.round(lastBot.botProb * 100)}% de las veces). Su mezcla: {lastBot.strategy.slice(0, 3).map((s) => `${Math.round(s.prob * 100)}% ${localiseNote(s.label, names)}`).join(' · ')}
        </p>
      )}
      <p className="text-[11px] text-faint">La IA no ve tu jugada ni tus Stat Points reales (supone los más usados del meta). Ve tus movimientos, objetos y habilidades porque Reg M-C se juega con hojas de equipo abiertas.</p>
    </div>
  );
}

/** Type effectiveness of a move type against a species (abilities like Levitate are not considered). */
function effectiveness(moveType: string, species: string): number {
  const types = getSpecies(species)?.types ?? [];
  if (!types.length) return 1;
  if (!dex.getImmunity(moveType, types)) return 0;
  return 2 ** dex.getEffectiveness(moveType, types);
}

/**
 * Your commands, inside the battle box: one Pokémon at a time ("¿Qué hará X?"), moves with type,
 * PP and effectiveness against each rival, Mega, switch, and targets picked by tapping the rival.
 * The turn is sent as soon as every Pokémon has an order.
 */
function useCommand(view: View, scene: SceneState, doubles: boolean, onChoose: (c: string) => void, live: boolean) {
  const { names } = useApp();
  const actives = view.team.filter((p) => p.active);
  const slots = view.phase === 'switch' ? view.forceSwitch.length : view.active.length;
  const needed = Array.from({ length: slots }, (_, s) => (view.phase === 'switch' ? !!view.forceSwitch[s] : !(actives[s]?.condition.endsWith('fnt') ?? true)));
  const [picks, setPicks] = useState<(string | undefined)[]>([]);
  const [cur, setCur] = useState(0);
  const [mode, setMode] = useState<'moves' | 'switch' | 'target'>('moves');
  const [pending, setPending] = useState<number>();
  const [mega, setMega] = useState(-1);

  const first = needed.findIndex(Boolean);
  useEffect(() => {
    setPicks([]);
    setCur(first < 0 ? 0 : first);
    setMode(view.phase === 'switch' ? 'switch' : 'moves');
    setPending(undefined);
    setMega(-1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  const nextOf = (s: number) => needed.findIndex((n, k) => n && k > s);
  const prevOf = (s: number) => {
    for (let k = s - 1; k >= 0; k--) if (needed[k]) return k;
    return -1;
  };
  const commit = (s: number, choice: string) => {
    const np = Object.assign([...picks], { [s]: choice });
    setPicks(np);
    setPending(undefined);
    const nx = nextOf(s);
    if (nx >= 0) {
      setCur(nx);
      setMode(view.phase === 'switch' ? 'switch' : 'moves');
      return;
    }
    const parts = needed.map((n, k) => (!n ? 'pass' : np[k]! + (mega === k && np[k]!.startsWith('move') ? ' mega' : '')));
    onChoose(parts.join(', '));
  };

  const me = view.phase === 'switch' ? undefined : actives[cur];
  const a = view.active[cur];
  const foes = scene.slots.p2.map((m, i) => (m && !m.fainted ? { slot: i, species: m.forme ?? m.species } : null)).filter(Boolean) as { slot: number; species: string }[];
  const allyT = cur === 0 ? -2 : -1;
  const pendingMove = pending !== undefined && a ? a.moves[pending] : undefined;
  const targetOpts = pendingMove
    ? [
        ...(pendingMove.target === 'adjacentAlly' || pendingMove.target === 'adjacentAllyOrSelf' ? [] : foes.map((f) => ({ t: f.slot + 1, side: 'p2' as Side, slot: f.slot, label: names.species(f.species) }))),
        ...(pendingMove.target === 'adjacentAlly' || pendingMove.target === 'adjacentAllyOrSelf' || pendingMove.target === 'any'
          ? scene.slots.p1[cur === 0 ? 1 : 0] && !scene.slots.p1[cur === 0 ? 1 : 0]!.fainted
            ? [{ t: allyT, side: 'p1' as Side, slot: cur === 0 ? 1 : 0, label: `${names.species(scene.slots.p1[cur === 0 ? 1 : 0]!.species)} (aliado)` }]
            : []
          : []),
      ]
    : [];
  const bench = view.team.map((p, i) => ({ p, i })).filter(({ p }) => !p.active && !p.condition.endsWith('fnt'));
  const pickMove = (j: number) => {
    const m = a!.moves[j]!;
    if (doubles && NEEDS_TARGET.has(m.target)) {
      setPending(j);
      setMode('target');
    } else commit(cur, `move ${j + 1}`);
  };

  const title =
    view.phase === 'switch' ? '¿Qué Pokémon sale?' : mode === 'target' ? `¿A quién? Toca un Pokémon o elige abajo.` : mode === 'switch' ? `¿Por quién cambias a ${names.species(me?.species)}?` : `¿Qué hará ${names.species(me?.species)}?`;

  const node = (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className="px-cmd-title mr-auto">{title}</span>
        {view.phase === 'move' && mode !== 'target' && a?.canMegaEvo && (mega < 0 || mega === cur) && (
          <button className={`px-btn text-xs ${mega === cur ? 'is-on' : ''}`} onClick={() => setMega(mega === cur ? -1 : cur)}>
            ✦ Megaevolución
          </button>
        )}
        {view.phase === 'move' && mode === 'moves' && !a?.trapped && bench.length > 0 && (
          <button className="px-btn text-xs" onClick={() => setMode('switch')}>
            ⇄ Pokémon
          </button>
        )}
        {view.phase === 'move' && mode !== 'moves' && (
          <button
            className="px-btn text-xs"
            onClick={() => {
              setMode('moves');
              setPending(undefined);
            }}
          >
            ← Ataques
          </button>
        )}
        {prevOf(cur) >= 0 && (
          <button
            className="px-btn text-xs"
            onClick={() => {
              setCur(prevOf(cur));
              setMode(view.phase === 'switch' ? 'switch' : 'moves');
              setPending(undefined);
            }}
          >
            ↶ Atrás
          </button>
        )}
      </div>

      {view.phase === 'move' && mode === 'moves' && a && (
        <div className="grid grid-cols-2 gap-1.5">
          {a.moves.map((m, j) => {
            const mv = dex.moves.get(m.move);
            const col = TYPE_COLORS[mv.type] ?? '#888';
            const effs = mv.category === 'Status' ? [] : foes.map((f) => ({ f, e: effectiveness(mv.type, f.species) })).filter((x) => x.e !== 1);
            return (
              <button key={j} disabled={m.disabled || m.pp <= 0} onClick={() => pickMove(j)} className="move-btn" style={{ '--c': col } as CSSProperties}>
                <span className="block text-[15px] leading-tight sm:text-base">{names.move(m.move)}</span>
                <span className="block text-[10px] opacity-95">
                  {names.type(mv.type)} · {mv.category === 'Status' ? 'Estado' : `Pot. ${mv.basePower || '—'}`} · PP {m.pp}/{m.maxpp}
                </span>
                {effs.length > 0 && (
                  <span className="mt-0.5 block text-[10px]">
                    {effs.map(({ f, e }) => (
                      <span key={f.slot} className={`eff-tag ${e === 0 ? 'eff-0' : e > 1 ? 'eff-2' : 'eff-05'}`}>
                        {e === 0 ? 'No afecta' : `×${e}`}
                        {doubles ? ` ${names.species(f.species)}` : ''}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {mode === 'target' && (
        <div className="flex flex-wrap gap-1.5">
          {targetOpts.map((o) => (
            <button key={o.t} className="px-btn" onClick={() => commit(cur, `move ${pending! + 1} ${o.t}`)}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      {(mode === 'switch' || view.phase === 'switch') && (
        <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
          {bench.map(({ p, i }) => {
            const taken = picks.some((x, k) => k !== cur && x === `switch ${i + 1}`);
            return (
              <button key={i} disabled={taken} className="px-btn flex items-center gap-1.5 text-left" onClick={() => commit(cur, `switch ${i + 1}`)}>
                <Sprite species={p.species} size={28} kind="icon" />
                <span className="min-w-0">
                  <span className="block truncate text-sm">{names.species(p.species)}</span>
                  <span className="block text-[10px] opacity-80">{p.condition.split(' ')[0]}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  const targeting =
    live && mode === 'target'
      ? {
          targets: targetOpts.map((o) => ({ side: o.side, slot: o.slot })),
          onPick: (side: Side, slot: number) => {
            const o = targetOpts.find((x) => x.side === side && x.slot === slot);
            if (o) commit(cur, `move ${pending! + 1} ${o.t}`);
          },
        }
      : undefined;
  return { node, targeting, activeSlot: view.phase === 'move' ? cur : undefined };
}
