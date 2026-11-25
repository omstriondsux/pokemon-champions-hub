import { useState } from 'react';
import { Loader2, Save, Wand2 } from 'lucide-react';
import type { Build, OptimizerResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { runAnalysis } from '../lib/worker';
import { uid, type Mode } from '../lib/types';
import { BuildEditor } from '../components/BuildEditor';
import { Empty, PageHeader, scoreColor, Segmented, signed, Sprite } from '../components/ui';

const STAT_ES: Record<string, string> = { hp: 'PS', atk: 'Atq', def: 'Def', spa: 'AtE', spd: 'DfE', spe: 'Vel' };

export default function BuildOptimizer() {
  const { pokemon, names, settings, regulation, snapshot, save, teams } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const options = pokemon.flatMap((p) => p.builds.map((b) => ({ p, b })));
  const [key, setKey] = useState(options[0]?.b.id ?? '');
  const sel = options.find((o) => o.b.id === key);
  const [draft, setDraft] = useState<Build | undefined>(sel?.b.build);
  const [res, setRes] = useState<OptimizerResult>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const choose = (id: string) => {
    setKey(id);
    setDraft(structuredClone(options.find((o) => o.b.id === id)?.b.build));
    setRes(undefined);
  };

  const run = async (b = draft) => {
    if (!b) return;
    setBusy(true);
    setErr(undefined);
    try {
      const s = await snapshot(mode);
      const team = teams.find((x) => x.id === settings.activeTeam[mode]);
      const teamItems = team ? team.members.filter((m) => m.buildId !== key).map((m) => pokemon.find((p) => p.id === m.pokemonId)?.builds.find((x) => x.id === m.buildId)?.build.item).filter(Boolean) as string[] : [];
      const r = await runAnalysis<{ result: OptimizerResult }>({ type: 'optimize', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, build: b, format: mode, topN: 16, teamItems });
      setRes(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const applied = (): Build | undefined => {
    if (!draft || !res) return undefined;
    let b = structuredClone(draft);
    if (res.spread) b = { ...b, sp: res.spread.sp };
    if (res.moveSwaps[0]) {
      const [from, to] = res.moveSwaps[0].label.includes('→') ? res.moveSwaps[0].label.split(' → ') : [undefined, res.moveSwaps[0].value];
      b = { ...b, moves: from ? b.moves.map((m) => (m === from ? to! : m)) : [...b.moves, to!] };
    }
    return b;
  };

  const saveAsNew = async (b: Build) => {
    if (!sel) return;
    const p = pokemon.find((x) => x.id === sel.p.id)!;
    await save('pokemon', { ...p, builds: [...p.builds, { id: uid(), name: `${sel.b.name} (optimizada)`, role: sel.b.role, build: b, notes: `Generada por el Build Optimizer (${new Date().toLocaleDateString()})` }] });
    setSaved('Guardada como build nueva en Mis Pokémon (la original no se modifica).');
  };

  if (!options.length) return <Empty>Añade Pokémon con builds en «Mis Pokémon» para optimizarlas.</Empty>;

  return (
    <div className="fade-up">
      <PageHeader
        title="Build Optimizer"
        subtitle="Evalúa una build contra el meta y mide el coste de oportunidad de cada movimiento, objeto, alineación y Stat Point."
        actions={
          <>
            <select className="input w-72" value={key} onChange={(e) => choose(e.target.value)}>
              {options.map(({ p, b }) => (
                <option key={b.id} value={b.id}>
                  {names.species(p.species)} · {b.name}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" disabled={busy || !draft} onClick={() => run()}>
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />} Analizar
            </button>
          </>
        }
      />
      {err && <p className="mb-3 text-sm text-bad">{err}</p>}

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="panel p-4">
          <div className="panel-title mb-3">Build (puedes editarla y volver a analizar)</div>
          {draft && <BuildEditor build={draft} onChange={(b) => (setDraft(b), setRes(undefined))} />}
        </div>

        <div className="space-y-4">
          {busy && !res && (
            <div className="panel flex items-center gap-2 p-4 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> Probando alternativas contra el top 16 del meta…
            </div>
          )}
          {!res && !busy && <Empty>Pulsa «Analizar». Se compara contra las builds probables del top 16 del meta (≈ 3–8 s).</Empty>}
          {res && (
            <>
              <div className="panel p-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="panel-title">Veredicto</span>
                  <span className="text-[11px] text-faint">
                    {res.evaluations} evaluaciones · {(res.elapsedMs / 1000).toFixed(1)} s
                  </span>
                </div>
                <ul className="space-y-1 text-sm">
                  {res.verdict.map((v, i) => (
                    <li key={i}>• {v}</li>
                  ))}
                </ul>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(res.spread || res.moveSwaps[0]) && (
                    <button className="btn btn-primary" onClick={() => saveAsNew(applied()!)}>
                      <Save size={14} /> Guardar versión optimizada (SP{res.moveSwaps[0] ? ' + movimiento' : ''})
                    </button>
                  )}
                  {(res.spread || res.moveSwaps[0]) && (
                    <button className="btn" onClick={() => (setDraft(applied()), setRes(undefined))}>
                      Aplicar al borrador
                    </button>
                  )}
                </div>
                {saved && <p className="mt-2 text-xs text-good">{saved}</p>}
              </div>

              <div className="panel p-4">
                <div className="panel-title mb-2">Valor de cada movimiento (J con él − J sin él)</div>
                {res.moves.map((m) => (
                  <div key={m.move} className="flex items-center gap-2 text-sm">
                    <span className="w-40">{names.move(m.move)}</span>
                    {m.status ? <span className="text-xs text-faint">estado · no medible en 1v1</span> : <span className={`num text-xs ${m.delta < 0.005 ? 'text-warn' : 'text-good'}`}>{(m.delta >= 0 ? '+' : '') + m.delta.toFixed(3)}</span>}
                    <span className="flex-1 truncate text-[11px] text-faint">{m.note}</span>
                  </div>
                ))}
                {res.moveSwaps.length > 0 && (
                  <>
                    <div className="panel-title mt-3 mb-1">Cambios que mejoran</div>
                    {res.moveSwaps.map((s) => (
                      <Row key={s.label} label={s.label.split(' → ').map(names.move).join(' → ')} delta={s.delta} />
                    ))}
                  </>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="panel p-4">
                  <div className="panel-title mb-2">Objetos</div>
                  {res.items.length ? res.items.map((i) => <Row key={i.label} label={names.item(i.label)} delta={i.delta} note={i.note} />) : <p className="text-xs text-faint">Con megapiedra el objeto no se compara.</p>}
                </div>
                <div className="panel p-4">
                  <div className="panel-title mb-2">Alineación</div>
                  {res.alignments.length ? res.alignments.map((a) => <Row key={a.label} label={`${names.nature(a.label)} (${a.note})`} delta={a.delta} />) : <p className="text-xs text-faint">La alineación actual es la mejor para este objetivo.</p>}
                </div>
              </div>

              <div className="panel p-4">
                <div className="panel-title mb-2">Stat Points</div>
                {res.spread ? (
                  <>
                    <p className="num text-sm">
                      {Object.entries(res.spread.sp)
                        .map(([k, v]) => `${STAT_ES[k]} ${v}`)
                        .join(' · ')}{' '}
                      <span className="text-good">(+{res.spread.delta.toFixed(3)})</span>
                    </p>
                    <ul className="mt-1 text-[11px] text-faint">
                      {res.spread.steps.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="text-sm text-muted">No hay redistribución con mejora medible (búsqueda local con pasos de 8, 4 y 2 SP).</p>
                )}
                <p className="mt-2 text-sm">
                  Velocidad <b className="num">{res.speed.speed}</b>: superas a {res.speed.outspeeds.length} del top, te superan {res.speed.outspedBy.length}. {res.speed.note}
                </p>
              </div>

              <div className="panel p-4">
                <div className="panel-title mb-2">Enfrentamientos contra el top (peor primero)</div>
                <div className="grid grid-cols-2 gap-1 md:grid-cols-3">
                  {res.rows.map((r) => (
                    <div key={r.species} className="flex items-center gap-1.5 text-xs">
                      <Sprite species={r.species} size={24} kind="icon" />
                      <span className="flex-1 truncate">{names.species(r.species)}</span>
                      <span className={`num ${scoreColor(r.score)}`}>{signed(r.score)}</span>
                    </div>
                  ))}
                </div>
                <ul className="mt-3 space-y-0.5 text-[11px] text-warn/90">
                  {res.limitations.map((l, i) => (
                    <li key={i}>△ {l}</li>
                  ))}
                </ul>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, delta, note }: { label: string; delta: number; note?: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="flex-1 truncate">{label}</span>
      {note && <span className="truncate text-[10px] text-faint">{note}</span>}
      <span className={`num text-xs ${delta > 0.002 ? 'text-good' : delta < -0.002 ? 'text-bad' : 'text-muted'}`}>
        {delta >= 0 ? '+' : ''}
        {delta.toFixed(3)}
      </span>
    </div>
  );
}
