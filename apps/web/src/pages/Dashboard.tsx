import { useEffect, useState } from 'react';
import { AlertTriangle, CalendarClock, Database, ShieldAlert, Users } from 'lucide-react';
import type { MetaSnapshot } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct, resolveTeam } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import type { Mode } from '../lib/types';
import { useTeamIssues } from './Teams';
import { Badge, PageHeader, scoreColor, Segmented, signed, Sprite } from '../components/ui';

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
        actions={<Segmented value={mode} onChange={setMode} options={[{ value: 'doubles', label: t('mode.doubles') }, { value: 'singles', label: t('mode.singles') }]} />}
      />

      <div className="mb-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Card icon={CalendarClock} title="Regulación activa">
          <div className="font-display text-2xl font-bold">{regulation.pack.name}</div>
          <div className="text-xs text-muted">
            {regulation.pack.validFrom.value} → {regulation.pack.validTo.value} {regulation.pack.validTo.confidence !== 'verified' && <Badge level={regulation.pack.validTo.confidence} title={regulation.pack.validTo.note} />}
          </div>
          {daysLeft <= 14 && (
            <p className="mt-2 text-xs text-warn">
              ⚠ Termina en {daysLeft} días. La próxima regulación traerá cambios de balance: cuando se publique, añade su paquete en <code>data/regulations</code>.
            </p>
          )}
          <p className="mt-1 text-xs text-faint">{unverified} reglas sin verificar (ver Ajustes).</p>
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
