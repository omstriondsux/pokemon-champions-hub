import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Info, Loader2, NotebookPen, RotateCcw, Save, ShieldCheck, Swords, Target, X, Zap } from 'lucide-react';
import { ARCHETYPE_LABEL, type AdvisorResult, type Alternative, type OpponentModel, type PoolEntry } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct, resolveTeam } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import { uid, type Mode, type Team } from '../lib/types';
import { poolFrom } from '../lib/pool';
import { navigate } from '../App';
import { useTeamIssues } from './Teams';
import { Combobox, ItemIcon, PageHeader, scoreColor, signed, Sprite, Types, useSpeciesOptions } from '../components/ui';

const ALT_ICON = { best: Target, conservative: ShieldCheck, aggressive: Zap } as const;

export const PREFILL_KEY = 'pch.battlePrefill';

export default function BattleAdvisor() {
  const { settings, teams, pokemon, regulation, snapshot, names, metaIndex, historyReveals, save, saveSettings } = useApp();
  const mode: Mode = settings.defaultMode;
  const team = teams.find((x) => x.id === settings.activeTeam[mode]);
  const myBuilds = resolveTeam(team, pokemon).builds;
  const teamIssues = useTeamIssues(team);
  const teamErrors = teamIssues.filter((i) => i.severity === 'error');
  const pool = useMemo(() => poolFrom(pokemon, names.species, { mode }), [pokemon, names, mode]);

  const [opps, setOpps] = useState<string[]>([]);
  const [tr, setTr] = useState(false);
  // "team": choose from your registered team · "counter": recommend what to play from every Pokémon
  const [source, setSource] = useState<'team' | 'counter'>(team ? 'team' : 'counter');
  useEffect(() => setSource((s) => (team ? s : 'counter')), [team]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [res, setRes] = useState<{ result: AdvisorResult; models: OpponentModel[]; team?: PoolEntry[] }>();
  const [savedMsg, setSavedMsg] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const options = useSpeciesOptions();
  const rules = regulation.format(mode);
  const snapEntry = metaIndex.find((m) => m.mode === mode);
  const builds = source === 'team' ? myBuilds : (res?.team?.map((p) => p.build) ?? []);

  const analyze = async (list = opps, src = source) => {
    if (!list.length || (src === 'team' && !myBuilds.length)) return;
    setBusy(true);
    setErr(undefined);
    setSavedMsg(undefined);
    try {
      const s = await snapshot(mode);
      const base = { pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, opponents: list, format: mode, trickRoom: tr, history: historyReveals };
      const r =
        src === 'team'
          ? await runAnalysis<{ result: AdvisorResult; models: OpponentModel[] }>({ type: 'advise', ...base, team: myBuilds })
          : await runAnalysis<{ result: AdvisorResult; models: OpponentModel[]; team: PoolEntry[] }>({ type: 'counter', ...base, pool });
      setRes(r);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (opps.length === 6) analyze(opps, source);
    else setRes(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opps, tr, source, team?.id]);

  const add = (s: string) => {
    if (opps.includes(s) || opps.length >= 6) return;
    setOpps([...opps, s]);
  };

  const logBattle = (alt?: Alternative) => {
    sessionStorage.setItem(PREFILL_KEY, JSON.stringify({ format: mode, teamId: source === 'team' ? team?.id : undefined, opponentTeam: opps, mySelection: alt?.members ?? [], myLeads: alt?.leads ?? [], advisorFollowed: alt?.kind ?? null }));
    navigate('history', { new: '1' });
  };

  const saveCounter = async () => {
    if (!res?.team) return;
    const t: Team = { id: uid(), name: `Contra ${opps.slice(0, 2).map(names.species).join(' + ')}`, format: mode, regulation: regulation.id, members: res.team.map((p) => ({ pokemonId: p.ownerId, buildId: p.id })), notes: `Recomendado por el Battle Advisor contra: ${opps.join(', ')}` };
    await save('teams', t);
    await saveSettings({ activeTeam: { ...settings.activeTeam, [mode]: t.id } });
    setSavedMsg(`Guardado como «${t.name}» y marcado como tu equipo activo.`);
  };

  return (
    <div className="fade-up">
      <PageHeader title="Battle Advisor" subtitle="Escribe el equipo del rival y te digo qué Pokémon sacar, quién empieza y qué riesgos hay." />

      {/* STEP 1 */}
      <div className="panel mb-4 p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="flex items-center gap-2 font-semibold">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-white">1</span> Equipo rival <span className="text-sm font-normal text-faint">({opps.length}/6)</span>
          </span>
          <div className="flex items-center gap-3 text-sm">
            <label className="flex items-center gap-1.5" title="Evalúa los enfrentamientos con el orden de velocidad invertido">
              <input type="checkbox" checked={tr} onChange={(e) => setTr(e.target.checked)} /> Bajo Trick Room
            </label>
            <button className="btn btn-ghost" onClick={() => (setOpps([]), inputRef.current?.focus())}>
              <RotateCcw size={14} /> Limpiar
            </button>
          </div>
        </div>
        <div onKeyDown={(e) => e.key === 'Backspace' && !(e.target as HTMLInputElement).value && setOpps(opps.slice(0, -1))}>
          <Combobox options={options} onChange={add} placeholder="Escribe 2–3 letras del Pokémon rival y pulsa Enter (Retroceso borra el último)" autoFocus clearOnSelect inputRef={inputRef} onEnterEmpty={() => analyze()} />
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const s = opps[i];
            const m = res?.models.find((x) => x.species === s);
            return (
              <div key={i} className={`relative min-h-28 rounded-lg border p-2 text-center ${s ? 'border-line-strong bg-panel-2' : 'border-dashed border-line'}`}>
                {s ? (
                  <>
                    <button className="absolute top-1 right-1 text-faint hover:text-bad" onClick={() => setOpps(opps.filter((x) => x !== s))} aria-label="Quitar">
                      <X size={13} />
                    </button>
                    <Sprite species={s} size={52} className="mx-auto" />
                    <div className="truncate text-xs font-medium">{names.species(s)}</div>
                    <div className="mt-0.5">
                      <Types species={s} small />
                    </div>
                    {m && m.usage > 0 && <div className="mt-1 text-[10px] text-faint">{pct(m.usage, 1)} de uso</div>}
                  </>
                ) : (
                  <div className="grid h-full place-items-center text-xs text-faint">{i + 1}</div>
                )}
              </div>
            );
          })}
        </div>
        {!snapEntry && <p className="mt-2 text-xs text-warn">Sin estadísticas de meta: todas las builds rivales serán hipótesis.</p>}
      </div>

      {/* STEP 2 */}
      <div className="panel mb-4 p-4">
        <div className="mb-3 flex items-center gap-2 font-semibold">
          <span className="grid h-6 w-6 place-items-center rounded-full bg-accent text-xs text-white">2</span> ¿Con qué juegas?
        </div>
        <div className="grid gap-2 md:grid-cols-2">
          <button
            disabled={!team}
            onClick={() => setSource('team')}
            className={`rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${source === 'team' ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
          >
            <div className="font-semibold">Con mi equipo registrado</div>
            <div className="text-xs text-muted">
              {team ? (
                <span className="flex items-center gap-1">
                  {team.name}:{' '}
                  {myBuilds.map((b, i) => (
                    <Sprite key={i} species={b.species} size={22} kind="icon" />
                  ))}
                </span>
              ) : (
                'Aún no tienes equipo activo (elígelo arriba o crea uno en Equipos).'
              )}
            </div>
            <div className="mt-1 text-[11px] text-faint">Lo que harías en ranked: eliges {rules.bring.value} de tus 6.</div>
          </button>
          <button onClick={() => setSource('counter')} className={`rounded-xl border p-3 text-left transition-colors ${source === 'counter' ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}>
            <div className="font-semibold">Recomiéndame qué jugar</div>
            <div className="text-xs text-muted">Arma el mejor equipo contra este rival con todos los Pokémon disponibles.</div>
            <div className="mt-1 text-[11px] text-faint">Útil para preparar equipos contra lo que más te encuentras.</div>
          </button>
        </div>
        {source === 'team' && teamErrors.length > 0 && <p className="mt-2 text-sm text-bad">⚠ Tu equipo tiene problemas de legalidad: {teamErrors[0]!.message}.</p>}
        {opps.length > 0 && opps.length < 6 && (
          <button className="btn btn-primary mt-3" disabled={busy} onClick={() => analyze()}>
            <Swords size={15} /> Analizar con {opps.length} rival{opps.length > 1 ? 'es' : ''}
          </button>
        )}
        {opps.length === 0 && <p className="mt-3 text-sm text-faint">Añade los Pokémon del rival en el paso 1: con 6 se analiza solo.</p>}
      </div>

      {err && <p className="mb-3 text-sm text-bad">{err}</p>}
      {busy && (
        <div className="panel mb-4 flex items-center gap-2 p-4 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> {source === 'counter' ? 'Buscando el mejor equipo entre los Pokémon disponibles…' : 'Calculando enfrentamientos…'}
        </div>
      )}
      {res && !busy && (
        <>
          {res.models[0]?.archetypes?.length ? (
            <div className="mb-3 rounded-lg border border-accent-2/40 bg-accent-2/10 px-3 py-2 text-sm">
              Arquetipo rival: <b>{res.models[0].archetypes.map((a) => ARCHETYPE_LABEL[a]).join(' · ')}</b>. Sus builds probables se ajustaron a ese estilo.
            </div>
          ) : null}
          {source === 'counter' && res.team && (
            <div className="panel mb-4 border-accent/60 p-4">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="font-display text-lg font-bold">Equipo recomendado contra este rival</span>
                <button className="btn btn-primary" onClick={saveCounter}>
                  <Save size={14} /> Guardar y usar como mi equipo
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2 md:grid-cols-6">
                {res.team.map((p) => (
                  <div key={p.id} className="rounded-lg bg-panel-2 p-2 text-center">
                    <Sprite species={p.build.species} size={56} className="mx-auto" />
                    <div className="truncate text-xs font-semibold">{names.species(p.build.species)}</div>
                    <div className="flex items-center justify-center gap-1 truncate text-[10px] text-faint">
                      <ItemIcon item={p.build.item} /> {names.item(p.build.item) || 'sin objeto'}
                    </div>
                  </div>
                ))}
              </div>
              {savedMsg && <p className="mt-2 text-sm text-good">{savedMsg}</p>}
            </div>
          )}
          <Results res={res.result} builds={builds} opps={opps} onLog={logBattle} />
        </>
      )}
    </div>
  );
}

function Results({ res, builds, opps, onLog }: { res: AdvisorResult; builds: { species: string }[]; opps: string[]; onLog: (a?: Alternative) => void }) {
  const { t, names } = useApp();
  return (
    <div className="space-y-4">
      <div className="grid gap-3 lg:grid-cols-3">
        {res.alternatives.map((a) => {
          const Icon = ALT_ICON[a.kind];
          return (
            <div key={a.kind} className={`panel flex flex-col p-4 ${a.kind === 'best' ? 'border-accent/60' : ''}`}>
              <div className="mb-3 flex items-center gap-2">
                <Icon size={17} className="text-accent" />
                <span className="font-display text-lg font-bold">{t(`alt.${a.kind}`)}</span>
              </div>
              {a.sameAs ? (
                <p className="text-sm text-muted">
                  Coincide con «{t(`alt.${a.sameAs}`)}»: con este equipo y este rival no hay una alternativa distinta que mejore este criterio.
                </p>
              ) : (
                <>
                  <div className="mb-3 flex gap-2">
                    {a.leads.map((i) => (
                      <Member key={i} species={builds[i]!.species} tag="Lead" lead />
                    ))}
                    {a.back.map((i) => (
                      <Member key={i} species={builds[i]!.species} tag="Reserva" />
                    ))}
                  </div>
                  <div className="mb-3 grid grid-cols-3 gap-1.5 text-center text-xs">
                    <Metric label="Media" v={a.expected} />
                    <Metric label="Peor 25%" v={a.worstQuartile} />
                    <Metric label="Mejor 25%" v={a.bestQuartile} />
                  </div>
                  <Section title="Por qué" items={a.strengths} tone="good" empty="Sin ventajas claras en 1v1." />
                  <Section title="Riesgos" items={a.risks} tone="bad" empty="Sin riesgos graves detectados en 1v1." />
                  <Section title="Condición de victoria" items={a.winConditions} tone="accent" />
                  {a.supportFactors?.length > 0 && <Section title={`Apoyo (+${a.support.toFixed(2)} incluido en la puntuación)`} items={a.supportFactors} tone="accent" />}
                  <Section title="Elección de leads" items={a.leadFactors} tone="muted" />
                  <button className="btn mt-auto self-start" onClick={() => onLog(a)}>
                    <NotebookPen size={14} /> Registrar combate con esta selección
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Matrix res={res} builds={builds} opps={opps} />
        <div className="panel p-4">
          <div className="panel-title mb-3">Amenazas del rival</div>
          <div className="space-y-2">
            {res.threats.map((th) => (
              <div key={th.opp} className="rounded-lg bg-panel-2 p-2 text-sm">
                <div className="flex items-center gap-2">
                  <Sprite species={th.species} size={32} kind="icon" />
                  <span className="flex-1 font-medium">{names.species(th.species)}</span>
                  <span className={`num text-xs ${scoreColor(-th.threat)}`}>{th.threat > 0 ? 'te supera' : 'controlable'} ({signed(-th.threat)})</span>
                </div>
                <div className="mt-1 text-xs text-muted">
                  {th.noAnswer ? <span className="text-bad">Sin respuesta clara en tu equipo (ningún 1v1 ≥ +0.25).</span> : <>Respuestas: {th.answers.slice(0, 3).map((a) => `${names.species(builds[a.member]!.species)} (${signed(a.score)})`).join(', ')}</>}
                </div>
                {th.dangerousVariant && (
                  <div className="mt-1 flex gap-1 text-xs text-warn">
                    <AlertTriangle size={13} className="shrink-0" /> Variante peligrosa: {th.dangerousVariant.label} ({pct(th.dangerousVariant.weight)})
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="panel p-4 text-xs text-muted">
        <div className="mb-2 flex items-center gap-1.5 font-semibold text-text">
          <Info size={14} /> Evidencia y limitaciones · {res.elapsedMs.toFixed(0)} ms
        </div>
        <ul className="grid gap-1 md:grid-cols-2">
          {res.evidence.map((e, i) => (
            <li key={`e${i}`}>✓ {e}</li>
          ))}
          {res.limitations.map((e, i) => (
            <li key={`l${i}`} className="text-warn/90">
              △ {e}
            </li>
          ))}
        </ul>
        <button className="btn mt-3" onClick={() => onLog()}>
          <NotebookPen size={14} /> Registrar combate (selección propia)
        </button>
      </div>
    </div>
  );
}

function Member({ species, tag, lead }: { species: string; tag: string; lead?: boolean }) {
  const { names } = useApp();
  return (
    <div className={`flex-1 rounded-lg p-1.5 text-center ${lead ? 'bg-accent/15 ring-1 ring-accent/50' : 'bg-panel-2'}`}>
      <Sprite species={species} size={48} className="mx-auto" />
      <div className="truncate text-[11px] font-medium">{names.species(species)}</div>
      <div className={`text-[10px] font-bold tracking-wider uppercase ${lead ? 'text-accent' : 'text-faint'}`}>{tag}</div>
    </div>
  );
}

function Metric({ label, v }: { label: string; v: number }) {
  return (
    <div className="rounded-md bg-panel-2 py-1.5">
      <div className={`num text-sm font-semibold ${scoreColor(v)}`}>{signed(v)}</div>
      <div className="text-[10px] text-faint">{label}</div>
    </div>
  );
}

function Section({ title, items, tone, empty }: { title: string; items: string[]; tone: 'good' | 'bad' | 'accent' | 'muted'; empty?: string }) {
  const color = { good: 'text-good', bad: 'text-bad', accent: 'text-accent-2', muted: 'text-muted' }[tone];
  if (!items.length && !empty) return null;
  return (
    <div className="mb-2.5">
      <div className={`mb-0.5 text-[11px] font-bold tracking-wider uppercase ${color}`}>{title}</div>
      <ul className="space-y-0.5 text-xs text-muted">{items.length ? items.map((s, i) => <li key={i}>• {s}</li>) : <li className="text-faint">{empty}</li>}</ul>
    </div>
  );
}

function Matrix({ res, builds, opps }: { res: AdvisorResult; builds: { species: string }[]; opps: string[] }) {
  const { names } = useApp();
  const [hover, setHover] = useState<[number, number]>();
  const d = hover ? res.matrix[hover[0]]![hover[1]]! : undefined;
  const bg = (v: number) => (v >= 0 ? `color-mix(in oklab, var(--good) ${Math.round(v * 70)}%, var(--panel-2))` : `color-mix(in oklab, var(--bad) ${Math.round(-v * 70)}%, var(--panel-2))`);
  const fmtPct = (p?: [number, number]) => (p ? `${p[0].toFixed(0)}–${p[1].toFixed(0)}%` : '—');
  const summary = useMemo(() => res.matrix.map((row) => row.reduce((s, p) => s + p.score, 0) / row.length), [res]);
  return (
    <div className="panel p-4">
      <div className="panel-title mb-3">Matriz 1v1 (tu equipo × rival)</div>
      <div className="overflow-auto">
        <table className="w-full border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th />
              {opps.map((o) => (
                <th key={o} className="font-normal">
                  <Sprite species={o} size={36} kind="icon" className="mx-auto" />
                </th>
              ))}
              <th className="font-normal text-faint">media</th>
            </tr>
          </thead>
          <tbody>
            {res.matrix.map((row, i) => (
              <tr key={i}>
                <td className="pr-2 whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    <Sprite species={builds[i]!.species} size={30} kind="icon" /> {names.species(builds[i]!.species)}
                  </span>
                </td>
                {row.map((p, j) => (
                  <td key={j} onMouseEnter={() => setHover([i, j])} onMouseLeave={() => setHover(undefined)} className="num h-9 min-w-14 cursor-default rounded-md text-center font-semibold" style={{ background: bg(p.score) }}>
                    {signed(p.score)}
                    {p.worst < p.score - 0.4 && <span className="ml-0.5 text-warn" title="Alguna build plausible del rival da la vuelta al 1v1">!</span>}
                  </td>
                ))}
                <td className={`num text-center ${scoreColor(summary[i]!)}`}>{signed(summary[i]!)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 min-h-14 rounded-lg bg-panel-2 p-2.5 text-xs text-muted">
        {d && hover ? (
          <>
            <b className="text-text">
              {names.species(builds[hover[0]]!.species)} vs {names.species(opps[hover[1]]!)}
            </b>{' '}
            · índice {signed(d.score)} (peor caso {signed(d.worst)}
            {d.worstLabel ? `: ${d.worstLabel}` : ''})
            <br />
            Tú: {names.move(d.detail.myBestMove) || '—'} {fmtPct(d.detail.myDamagePct)} → ~{d.detail.myHitsToKO.toFixed(1)} usos · Rival: {names.move(d.detail.theirBestMove) || '—'} {fmtPct(d.detail.theirDamagePct)} → ~{d.detail.theirHitsToKO.toFixed(1)} usos · Velocidad {d.detail.mySpeed} vs {d.detail.theirSpeed} (P(primero) {pct(d.detail.pFirst)})
          </>
        ) : (
          'Pasa el ratón por una celda para ver el cálculo. Índice heurístico en [−1, +1] (no es probabilidad de victoria): usos esperados para el KO en cada sentido + quién se mueve primero, promediado sobre las builds plausibles del rival.'
        )}
      </div>
    </div>
  );
}
