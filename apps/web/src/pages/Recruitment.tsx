import { useState } from 'react';
import { Award, Loader2, X } from 'lucide-react';
import type { RecruitResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { usePool } from '../lib/pool';
import { runAnalysis } from '../lib/worker';
import type { Mode } from '../lib/types';
import { Combobox, Empty, PageHeader, Segmented, Sprite, Types, useSpeciesOptions } from '../components/ui';

export default function Recruitment() {
  const { settings, regulation, snapshot, names } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [cands, setCands] = useState<{ species: string; cost: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RecruitResult>();
  const [err, setErr] = useState<string>();
  const options = useSpeciesOptions();
  const pool = usePool(false);

  const run = async () => {
    setBusy(true);
    setErr(undefined);
    try {
      const s = await snapshot(mode);
      const r = await runAnalysis<{ result: RecruitResult }>({
        type: 'recruit',
        pack: regulation.pack,
        snapshot: s,
        snapshotKey: s?.meta.url,
        candidates: cands.map((c) => ({ species: c.species, cost: c.cost ? Number(c.cost) : null })),
        pool,
        format: mode,
        topN: 24,
      });
      setRes(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fade-up">
      <PageHeader
        title="Recruitment Advisor"
        subtitle="Introduce las opciones que te ofrece el juego. Se distingue entre el mejor Pokémon en general y el mejor para TU inventario."
        actions={<Segmented value={mode} onChange={(m) => (setMode(m), setRes(undefined))} options={[{ value: 'doubles', label: 'Dobles' }, { value: 'singles', label: 'Individuales' }]} />}
      />
      <div className="panel mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_auto]">
          <Combobox options={options} onChange={(s) => !cands.some((c) => c.species === s) && (setCands([...cands, { species: s, cost: '' }]), setRes(undefined))} placeholder="Añade cada opción (2–3 letras + Enter)" clearOnSelect autoFocus />
          <button className="btn btn-primary" disabled={cands.length < 1 || busy} onClick={run}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Award size={15} />} Evaluar opciones
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {cands.map((c, i) => (
            <div key={c.species} className="flex items-center gap-2 rounded-lg bg-panel-2 py-1 pr-2 pl-1">
              <Sprite species={c.species} size={36} kind="icon" />
              <span className="text-sm">{names.species(c.species)}</span>
              <input className="input num w-24 py-0.5 text-xs" placeholder="coste (opc.)" value={c.cost} onChange={(e) => setCands(cands.map((x, k) => (k === i ? { ...x, cost: e.target.value } : x)))} />
              <button className="text-faint hover:text-bad" onClick={() => (setCands(cands.filter((_, k) => k !== i)), setRes(undefined))}>
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-faint">Tienes {pool.length} builds disponibles. Con 4 o más se calcula cuánto mejora tu mejor equipo posible; con menos, solo el rendimiento individual.</p>
      </div>
      {err && <p className="mb-3 text-sm text-bad">{err}</p>}
      {!res && !busy && <Empty>Añade las opciones de reclutamiento y pulsa «Evaluar opciones».</Empty>}
      {res && (
        <>
          <div className="panel mb-4 border-accent/60 p-4">
            <div className="panel-title mb-2">Recomendación ({res.basis === 'inventory' ? 'según tu inventario' : 'solo rendimiento individual'})</div>
            {res.verdict.map((v, i) => (
              <p key={i} className="text-sm">
                {v}
              </p>
            ))}
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            {res.rows.map((r) => (
              <div key={r.species} className={`panel p-4 ${r.rank === 1 ? 'border-accent/60' : ''}`}>
                <div className="mb-2 flex items-center gap-3">
                  <span className="font-display text-3xl font-bold text-faint">#{r.rank}</span>
                  <Sprite species={r.species} size={56} />
                  <div className="flex-1">
                    <div className="font-semibold">{names.species(r.species)}</div>
                    <Types species={r.species} small />
                  </div>
                  <div className="text-right text-xs">
                    <div>
                      individual <b className="num">{r.individual.toFixed(2)}</b>
                    </div>
                    {r.marginal !== null && (
                      <div>
                        para ti <b className={`num ${r.marginal > 0.004 ? 'text-good' : 'text-muted'}`}>{r.marginal >= 0 ? '+' : ''}{r.marginal.toFixed(3)}</b>
                      </div>
                    )}
                    {r.valuePerCost !== null && <div className="text-faint">valor/coste {r.valuePerCost.toFixed(4)}</div>}
                  </div>
                </div>
                <ul className="space-y-0.5 text-xs text-muted">
                  {r.reasons.map((x, i) => (
                    <li key={i}>• {x}</li>
                  ))}
                  <li className="text-faint">Build evaluada: {r.buildSource}.</li>
                </ul>
              </div>
            ))}
          </div>
          <div className="mt-3 text-[11px] text-warn/90">
            {res.limitations.map((l, i) => (
              <p key={i}>△ {l}</p>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
