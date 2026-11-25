import { useMemo, useState } from 'react';
import { Loader2, Lock, Save, Sparkles } from 'lucide-react';
import { PROFILE_LABEL, type SquadProfile, type SquadResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { usePool } from '../lib/pool';
import { runAnalysis } from '../lib/worker';
import { uid, type Mode } from '../lib/types';
import { Empty, ItemIcon, PageHeader, Segmented, Sprite } from '../components/ui';

const TERM_ES: Record<string, string> = { coverage: 'Cobertura', consistency: 'Consistencia', depth: 'Profundidad', offense: 'Ofensiva', speed: 'Control vel.', support: 'Apoyo', weakness: 'Debilidades', favorites: 'Favoritos', cost: 'Coste' };

export default function SquadBuilder() {
  const { settings, regulation, snapshot, names, save } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [profile, setProfile] = useState<SquadProfile>('balanced');
  const [includePending, setIncludePending] = useState(false);
  const pool = usePool(includePending);
  const [locked, setLocked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [res, setRes] = useState<SquadResult>();
  const [err, setErr] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [q, setQ] = useState('');
  const shown = useMemo(() => pool.filter((p) => !q || p.label.toLowerCase().includes(q.toLowerCase())), [pool, q]);

  const run = async () => {
    setBusy(true);
    setErr(undefined);
    setProgress(0);
    try {
      const s = await snapshot(mode);
      const r = await runAnalysis<{ result: SquadResult }>({ type: 'squad', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, pool, format: mode, profile, locked, topN: 24 }, setProgress);
      setRes(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const saveTeam = async (members: number[], i: number) => {
    await save('teams', { id: uid(), name: `${PROFILE_LABEL[profile]} #${i + 1}`, format: mode, regulation: regulation.id, members: members.map((m) => ({ pokemonId: pool[m]!.ownerId, buildId: pool[m]!.id })), notes: 'Generado por el Squad Builder' });
    setMsg('Equipo guardado en «Equipos».');
  };

  if (pool.length < 2) return <Empty>Necesitas al menos 2 builds disponibles en «Mis Pokémon» para construir equipos.</Empty>;

  return (
    <div className="fade-up">
      <PageHeader
        title="Squad Builder"
        subtitle="Construye equipos con los Pokémon disponibles (los 60 más usados, más tus favoritos y builds editadas). Fija los obligatorios y el sistema completa el resto según el objetivo."
      />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <div className="panel p-4">
          <label className="label">Objetivo</label>
          <select className="input mb-3" value={profile} onChange={(e) => (setProfile(e.target.value as SquadProfile), setRes(undefined))}>
            {(Object.keys(PROFILE_LABEL) as SquadProfile[]).map((p) => (
              <option key={p} value={p}>
                {PROFILE_LABEL[p]}
              </option>
            ))}
          </select>
          <label className="mb-3 flex items-center gap-1.5 text-sm">
            <input type="checkbox" checked={includePending} onChange={(e) => setIncludePending(e.target.checked)} /> Incluir pendientes de reclutar/entrenar
          </label>
          <div className="label">Fijar obligatorios ({locked.length}) — clic en el candado</div>
          <input className="input mb-2" placeholder="Filtrar…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="max-h-[50vh] space-y-1 overflow-auto">
            {shown.map((p) => {
              const on = locked.includes(p.id);
              return (
                <button key={p.id} onClick={() => setLocked(on ? locked.filter((x) => x !== p.id) : [...locked, p.id])} className={`flex w-full items-center gap-2 rounded-md border px-2 py-1 text-left text-xs ${on ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-panel-2'}`}>
                  <Sprite species={p.build.species} size={28} kind="icon" />
                  <span className="flex-1 truncate">{p.label}</span>
                  <ItemIcon item={p.build.item} />
                  <Lock size={13} className={on ? 'text-accent' : 'text-faint'} />
                </button>
              );
            })}
          </div>
          <button className="btn btn-primary mt-3 w-full justify-center" disabled={busy} onClick={run}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} {busy ? `Calculando ${(progress * 100).toFixed(0)}%` : 'Construir equipos'}
          </button>
          <p className="mt-2 text-[11px] text-faint">{pool.length} builds candidatas × top 24 del meta. La primera vez puede tardar unos segundos; luego se reutiliza la caché.</p>
        </div>

        <div className="space-y-4">
          {err && <p className="text-sm text-bad">{err}</p>}
          {msg && <p className="text-sm text-good">{msg}</p>}
          {!res && !busy && <Empty>Elige un objetivo y pulsa «Construir equipos». No se eligen automáticamente los más populares: cada miembro entra solo si mejora la puntuación del equipo.</Empty>}
          {res?.teams.map((t, i) => (
            <div key={i} className={`panel p-4 ${i === 0 ? 'border-accent/60' : ''}`}>
              <div className="mb-3 flex items-center justify-between">
                <span className="font-display text-lg font-bold">
                  Opción {i + 1} · puntuación {t.score.toFixed(3)}
                </span>
                <button className="btn" onClick={() => saveTeam(t.members, i)}>
                  <Save size={14} /> Guardar como equipo
                </button>
              </div>
              <div className="mb-3 grid grid-cols-3 gap-2 md:grid-cols-6">
                {t.members.map((m) => {
                  const c = t.contributions.find((x) => x.member === m);
                  return (
                    <div key={m} className={`rounded-lg p-2 text-center ${locked.includes(pool[m]!.id) ? 'bg-accent/15 ring-1 ring-accent/50' : 'bg-panel-2'}`}>
                      <Sprite species={pool[m]!.build.species} size={52} className="mx-auto" />
                      <div className="truncate text-[11px] font-medium">{pool[m]!.label}</div>
                      <div className="num text-[10px] text-faint" title="Puntuación que pierde el equipo si se quita">
                        aporta {c ? c.delta.toFixed(3) : '—'}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="mb-2 flex flex-wrap gap-1.5">
                {Object.entries(t.terms).map(([k, v]) => (
                  <span key={k} className="chip">
                    {TERM_ES[k]} <b className="num text-text">{v.toFixed(2)}</b>
                  </span>
                ))}
              </div>
              {t.uncovered.length > 0 ? (
                <p className="text-xs text-bad">
                  Sin respuesta clara: {t.uncovered.slice(0, 8).map((u) => `${names.species(u.species)} (${(u.usage * 100).toFixed(0)}%)`).join(', ')}
                </p>
              ) : (
                <p className="text-xs text-good">Respuesta 1v1 para todo el top 24.</p>
              )}
              {t.weaknesses.length > 0 && <p className="mt-1 text-xs text-warn">Debilidad compartida por 3+: {t.weaknesses.join(', ')}</p>}
            </div>
          ))}
          {res && (
            <div className="panel p-4 text-xs text-muted">
              {res.evidence.map((e, i) => (
                <p key={i}>✓ {e}</p>
              ))}
              {res.limitations.map((e, i) => (
                <p key={i} className="text-warn/90">
                  △ {e}
                </p>
              ))}
              <p className="mt-1 text-faint">{(res.elapsedMs / 1000).toFixed(1)} s</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
