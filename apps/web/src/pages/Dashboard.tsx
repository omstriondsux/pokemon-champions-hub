import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Database, ShieldAlert, Users } from 'lucide-react';
import type { MetaSnapshot } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct, resolveTeam } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import type { Mode } from '../lib/types';
import { useTeamIssues } from './Teams';
import { Badge, PageHeader, scoreColor, signed, Sprite } from '../components/ui';
import { ArrowRight, CheckCircle2, Circle, Swords as SwordsIcon, Boxes, Sparkles, MessageSquare } from 'lucide-react';
import { MasterBall } from '../components/MasterBall';
import { STATIC } from '../lib/api';

interface ThreatRow {
  species: string;
  usage: number;
  reliability: string;
  scores: number[];
  best: number;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default function Dashboard() {
  const { regulation, settings, snapshot, teams, pokemon, battles, names, t } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [snap, setSnap] = useState<MetaSnapshot>();
  const [threats, setThreats] = useState<{ rows: ThreatRow[]; skipped?: string[]; elapsedMs: number }>();
  const [threatErr, setThreatErr] = useState<string>();
  const [loadingThreats, setLoadingThreats] = useState(false);
  const team = teams.find((x) => x.id === settings.activeTeam[mode]);
  const { builds } = resolveTeam(team, pokemon);
  const teamIssues = useTeamIssues(team);
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = daysBetween(today, regulation.pack.validTo.value);
  const unverified = countUnverified(regulation.pack);

  useEffect(() => {
    snapshot(mode).then(setSnap);
  }, [mode, snapshot]);

  useEffect(() => {
    if (!builds.length || !snap) return setThreats(undefined);
    let live = true;
    setLoadingThreats(true);
    setThreatErr(undefined);
    runAnalysis<{ result: { rows: ThreatRow[]; skipped?: string[]; elapsedMs: number } }>({ type: 'metaThreats', pack: regulation.pack, snapshot: snap, snapshotKey: snap.meta.url, team: builds, format: mode, topN: 20 })
      .then((r) => live && setThreats(r.result))
      .catch((e) => live && setThreatErr(String(e)))
      .finally(() => live && setLoadingThreats(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, team?.updatedAt, snap, mode]);

  const top = snap ? Object.entries(snap.pokemon).sort((a, b) => b[1].usage - a[1].usage).slice(0, 12) : [];
  const snapAge = snap ? daysBetween(snap.meta.retrievedAt.slice(0, 10), today) : 0;
  const recent = battles.filter((b) => b.format === mode).slice(0, 20);
  const unanswered = threats?.rows.filter((r) => r.best < 0.25) ?? [];

  return (
    <div className="fade-up">
      <PageHeader
        title={t('nav.dashboard')}
        subtitle="Resumen del meta, alertas y estado de tu equipo activo."
      />

      {!STATIC && <GettingStarted mode={mode} />}
      <QuickActions />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card icon={CalendarClock} title="Regulación activa">
          <div className="font-display text-2xl font-bold">{regulation.pack.name}</div>
          <div className="text-xs text-muted">
            {regulation.pack.validFrom.value} → {regulation.pack.validTo.value} {regulation.pack.validTo.confidence !== 'verified' && <Badge level={regulation.pack.validTo.confidence} title={regulation.pack.validTo.note} />}
          </div>
          {daysLeft <= 14 && (
            <p className="mt-2 text-xs text-warn">
              ⚠ Termina en {daysLeft} días. La próxima regulación traerá cambios de balance{STATIC ? '.' : <>: cuando se publique, añade su paquete en <code>data/regulations</code>.</>}
            </p>
          )}
          {!STATIC && <p className="mt-1 text-xs text-faint">{unverified} reglas sin verificar (ver Ajustes).</p>}
        </Card>
        <Card icon={Database} title="Datos del meta">
          {snap ? (
            <>
              <div className="font-display text-2xl font-bold">{snap.meta.battles.toLocaleString()} combates</div>
              <div className="flex flex-wrap items-center gap-1 text-xs text-muted">
                Smogon {snap.meta.month} · ≥{snap.meta.ratingCutoff} <Badge level="simulator" />
              </div>
              <p className="mt-1 text-xs text-faint">{snap.meta.disclaimer}</p>
              {snapAge > 40 && <p className="mt-1 text-xs text-warn">⚠ Descargado hace {snapAge} días: ejecuta npm run ingest:smogon.</p>}
            </>
          ) : (
            <p className="text-sm text-warn">Sin estadísticas para este modo.</p>
          )}
        </Card>
        <Card icon={Users} title="Equipo activo">
          {team ? (
            <>
              <div className="font-display text-2xl font-bold">{team.name}</div>
              <div className="mt-1 flex gap-0.5">
                {builds.map((b, i) => (
                  <Sprite key={i} species={b.species} size={30} kind="icon" />
                ))}
              </div>
              {teamIssues.some((i) => i.severity === 'error') ? <p className="mt-1 text-xs text-bad">⚠ {teamIssues.filter((i) => i.severity === 'error').length} problema(s) de legalidad</p> : <p className="mt-1 text-xs text-good">Legal en {regulation.id}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">
              Ninguno. <a className="text-accent underline" href="#/teams">Elegir uno</a>
            </p>
          )}
        </Card>
        <Card icon={ShieldAlert} title="Historial reciente">
          <div className="font-display text-2xl font-bold">
            {recent.filter((b) => b.result === 'win').length}–{recent.filter((b) => b.result === 'loss').length}
          </div>
          <div className="text-xs text-muted">últimos {recent.length} combates en {t(`mode.${mode}`).toLowerCase()}</div>
          {recent.length < 10 && <p className="mt-1 text-xs text-faint">Muestra demasiado pequeña para sacar conclusiones.</p>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="panel p-4">
          <div className="panel-title mb-3">Pokémon más usados</div>
          <div className="grid grid-cols-2 gap-1.5 md:grid-cols-3">
            {top.map(([name, m], i) => (
              <div key={name} className="flex items-center gap-2 rounded-lg bg-panel-2 px-2 py-1.5">
                <span className="num w-5 text-xs text-faint">{i + 1}</span>
                <Sprite species={name} size={32} kind="icon" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{names.species(name)}</div>
                  <div className="num text-[11px] text-faint">{pct(m.usage, 1)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="panel-title">Amenazas del meta para tu equipo</span>
            {threats && <span className="text-[11px] text-faint">{threats.elapsedMs.toFixed(0)} ms</span>}
          </div>
          {!team ? (
            <p className="text-sm text-muted">Marca un equipo activo para ver qué Pokémon del meta no puedes enfrentar.</p>
          ) : threatErr ? (
            <p className="text-sm text-bad">No se pudo calcular: {threatErr}</p>
          ) : loadingThreats && !threats ? (
            <p className="text-sm text-muted">Calculando 1v1 contra el top 20…</p>
          ) : threats ? (
            <>
              {unanswered.length > 0 ? (
                <p className="mb-2 flex gap-1.5 text-sm text-bad">
                  <AlertTriangle size={16} className="shrink-0" /> {unanswered.length} de los 20 más usados no tienen respuesta clara (ningún 1v1 ≥ +0.25): {unanswered.map((r) => names.species(r.species)).join(', ')}.
                </p>
              ) : (
                <p className="mb-2 text-sm text-good">Tienes al menos una respuesta 1v1 para cada uno de los 20 más usados.</p>
              )}
              <div className="max-h-80 space-y-1 overflow-auto">
                {[...threats.rows]
                  .sort((a, b) => a.best - b.best)
                  .map((r) => {
                    const bi = r.scores.indexOf(r.best);
                    return (
                      <div key={r.species} className="flex items-center gap-2 text-sm">
                        <Sprite species={r.species} size={28} kind="icon" />
                        <span className="w-32 truncate">{names.species(r.species)}</span>
                        <span className="num w-12 text-[11px] text-faint">{pct(r.usage, 1)}</span>
                        <span className="flex-1 truncate text-xs text-muted">mejor respuesta: {names.species(builds[bi]?.species)}</span>
                        <span className={`num text-xs font-semibold ${scoreColor(r.best)}`}>{signed(r.best)}</span>
                      </div>
                    );
                  })}
              </div>
              {!!threats.skipped?.length && <p className="mt-2 text-[11px] text-warn">Omitidos por datos incompletos: {threats.skipped.join('; ')}</p>}
              <p className="mt-2 text-[11px] text-faint">Índice 1v1 heurístico promediado sobre las builds plausibles de cada rival. No considera apoyo ni posicionamiento.</p>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function Card({ icon: Icon, title, children }: { icon: React.ComponentType<{ size?: number }>; title: string; children: React.ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="mb-2 flex items-center gap-1.5 text-muted">
        <Icon size={14} />
        <span className="panel-title">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function countUnverified(obj: unknown): number {
  if (!obj || typeof obj !== 'object') return 0;
  const o = obj as Record<string, unknown>;
  if ('confidence' in o && 'value' in o) return o.confidence === 'verified' ? 0 : 1;
  return Object.values(o).reduce<number>((s, v) => s + countUnverified(v), 0);
}

function GettingStarted({ mode }: { mode: Mode }) {
  const { pokemon, teams, settings, battles } = useApp();
  const steps = [
    settings.ownAll
      ? { done: true, title: 'Tienes todos los Pokémon', text: 'Cada uno con sus builds más usadas del meta, listas para usar.', href: '#/pokemon', cta: 'Ver Pokémon' }
      : { done: pokemon.length > 0, title: 'Añade tus Pokémon', text: 'Uno a uno o pegando un equipo en formato Showdown.', href: '#/pokemon', cta: 'Ir a Mis Pokémon' },
    { done: teams.some((x) => x.format === mode), title: `Crea un equipo de ${mode === 'doubles' ? 'dobles' : 'individuales'}`, text: 'Elige 6 Pokémon tú mismo o deja que el Squad Builder lo arme.', href: '#/squad', cta: 'Armar equipo' },
    { done: !!settings.activeTeam[mode], title: 'Márcalo como equipo activo', text: 'Arriba a la derecha, en «Equipo». Todo el análisis usa ese equipo.', href: '#/teams', cta: 'Elegir equipo' },
    { done: battles.length > 0, title: 'Usa el Battle Advisor en tu próximo combate', text: 'Escribe los 6 rivales en la vista previa y te dice a quién sacar.', href: '#/advisor', cta: 'Abrir Advisor' },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  const next = steps.find((s) => !s.done)!;
  return (
    <div className="panel mb-4 overflow-hidden">
      <div className="flex items-center gap-4 border-b border-line bg-gradient-to-r from-accent/15 to-transparent px-5 py-4">
        <MasterBall size={44} />
        <div className="flex-1">
          <div className="font-display text-xl font-bold">Primeros pasos</div>
          <div className="text-sm text-muted">
            {doneCount} de {steps.length} completados · siguiente: <b className="text-text">{next.title}</b>
          </div>
        </div>
        <a href={next.href} className="btn btn-primary">
          {next.cta} <ArrowRight size={15} />
        </a>
      </div>
      <div className="grid gap-px bg-line md:grid-cols-4">
        {steps.map((s, i) => (
          <a key={i} href={s.href} className={`flex gap-3 bg-panel p-4 transition-colors hover:bg-panel-2 ${s === next ? 'ring-1 ring-accent/50 ring-inset' : ''}`}>
            {s.done ? <CheckCircle2 size={20} className="shrink-0 text-good" /> : <Circle size={20} className={`shrink-0 ${s === next ? 'text-accent' : 'text-faint'}`} />}
            <div>
              <div className={`text-sm font-semibold ${s.done ? 'text-muted line-through' : ''}`}>
                {i + 1}. {s.title}
              </div>
              <div className="text-xs text-faint">{s.text}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function QuickActions() {
  const actions = [
    { href: '#/advisor', icon: SwordsIcon, title: 'Analizar rival', text: 'Antes del combate', primary: true },
    { href: '#/pokemon', icon: Boxes, title: 'Mis Pokémon', text: 'Añadir o editar' },
    { href: '#/squad', icon: Sparkles, title: 'Armar equipo', text: 'Con tu inventario' },
    { href: '#/coach', icon: MessageSquare, title: '¿Qué mejoro?', text: 'Debilidades del equipo' },
  ];
  return (
    <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {actions.map((a) => {
        const Icon = a.icon;
        return (
          <a key={a.href} href={a.href} className={`panel flex items-center gap-3 p-4 transition-all hover:-translate-y-0.5 hover:border-accent/60 ${a.primary ? 'border-accent/50 bg-gradient-to-br from-accent/20 to-transparent' : ''}`}>
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${a.primary ? 'bg-accent text-white' : 'bg-panel-2 text-accent'}`}>
              <Icon size={22} />
            </span>
            <span>
              <span className="block font-semibold">{a.title}</span>
              <span className="block text-xs text-faint">{a.text}</span>
            </span>
            <ArrowRight size={16} className="ml-auto text-faint" />
          </a>
        );
      })}
    </div>
  );
}
