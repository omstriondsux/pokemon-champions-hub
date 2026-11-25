import { useEffect, useMemo, useState } from 'react';
import { Check, ChevronDown, Loader2, Save, Wand2 } from 'lucide-react';
import { dex, type Build, type OptimizerResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { runAnalysis } from '../lib/worker';
import { uid } from '../lib/types';
import { BuildEditor } from '../components/BuildEditor';
import { Combobox, Empty, ItemIcon, PageHeader, scoreColor, signed, Sprite, Types } from '../components/ui';

const STAT_ES: Record<string, string> = { hp: 'PS', atk: 'Ataque', def: 'Defensa', spa: 'At. Esp.', spd: 'Def. Esp.', spe: 'Velocidad' };

/** Objective J ∈ roughly [-1.35, 1.35] → a 0–100 grade that people can read. */
const grade = (j: number) => Math.max(0, Math.min(100, Math.round(50 + (50 * j) / 1.35)));
const points = (d: number) => (d * 50) / 1.35;

interface Rec {
  key: string;
  title: string;
  detail: string;
  gain: number; // points
  apply?: (b: Build) => Build;
  note?: string;
}

export default function BuildOptimizer() {
  const { pokemon, names, settings, regulation, snapshot, save, teams } = useApp();
  const mode = settings.defaultMode;
  const speciesOptions = useMemo(
    () => pokemon.map((p) => ({ value: p.id, label: names.species(p.species), keys: [p.species.toLowerCase().replace(/[^a-z0-9]/g, ''), names.species(p.species).toLowerCase().replace(/[^a-z0-9]/g, '')], icon: <Sprite species={p.species} size={26} kind="icon" /> })),
    [pokemon, names],
  );
  const [pid, setPid] = useState<string | undefined>(pokemon[0]?.id);
  const owner = pokemon.find((p) => p.id === pid);
  const [bid, setBid] = useState<string | undefined>(owner?.builds[0]?.id);
  useEffect(() => setBid(owner?.builds.find((b) => b.id.includes(mode === 'singles' ? '-s' : '-d'))?.id ?? owner?.builds[0]?.id), [pid, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  const ob = owner?.builds.find((b) => b.id === bid);
  const [draft, setDraft] = useState<Build | undefined>(ob?.build);
  useEffect(() => {
    setDraft(ob ? structuredClone(ob.build) : undefined);
    setRes(undefined);
    setApplied([]);
  }, [bid]); // eslint-disable-line react-hooks/exhaustive-deps
  const [res, setRes] = useState<OptimizerResult>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [msg, setMsg] = useState<string>();
  const [applied, setApplied] = useState<string[]>([]);
  const [showDetails, setShowDetails] = useState(false);
  const [showEditor, setShowEditor] = useState(false);

  const run = async () => {
    if (!draft) return;
    setBusy(true);
    setErr(undefined);
    setMsg(undefined);
    setApplied([]);
    try {
      const s = await snapshot(mode);
      const team = teams.find((x) => x.id === settings.activeTeam[mode]);
      const teamItems = team ? (team.members.filter((m) => m.buildId !== bid).map((m) => pokemon.find((p) => p.id === m.pokemonId)?.builds.find((x) => x.id === m.buildId)?.build.item).filter(Boolean) as string[]) : [];
      const r = await runAnalysis<{ result: OptimizerResult }>({ type: 'optimize', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, build: draft, format: mode, topN: 16, teamItems });
      setRes(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const recs: Rec[] = useMemo(() => {
    if (!res) return [];
    const out: Rec[] = [];
    if (res.spread) {
      const sp = res.spread.sp;
      out.push({
        key: 'spread',
        title: 'Reparte mejor los Stat Points',
        detail: Object.entries(sp)
          .filter(([, v]) => v > 0)
          .map(([k, v]) => `${STAT_ES[k]} ${v}`)
          .join(' · '),
        gain: points(res.spread.delta),
        apply: (b) => ({ ...b, sp }),
      });
    }
    const swap = res.moveSwaps[0];
    if (swap) {
      const [from, to] = swap.label.includes(' → ') ? swap.label.split(' → ') : [undefined, swap.value];
      out.push({
        key: 'move',
        title: from ? `Cambia ${names.move(from)} por ${names.move(to)}` : `Añade ${names.move(to)}`,
        detail: from ? `${names.move(from)} es el movimiento que menos aporta contra el meta.` : 'Tienes un hueco de movimiento libre.',
        gain: points(swap.delta),
        apply: (b) => ({ ...b, moves: from ? b.moves.map((m) => (m === from ? to! : m)) : [...b.moves, to!] }),
        note:
          from && mode === 'doubles' && ['allAdjacentFoes', 'allAdjacent'].includes(dex.moves.get(from).target)
            ? `Ojo: ${names.move(from)} golpea a los dos rivales a la vez; la nota compara 1 contra 1 y no valora del todo ese daño doble. Piénsalo antes de quitarlo.`
            : undefined,
      });
    }
    const item = res.items.find((i) => i.delta > 0.004 && !i.note?.includes('Item Clause'));
    if (item) out.push({ key: 'item', title: `Usa ${names.item(item.value)}`, detail: `En lugar de ${names.item(draft?.item) || 'nada'}.`, gain: points(item.delta), apply: (b) => ({ ...b, item: item.value }), note: item.note });
    const al = res.alignments[0];
    if (al) out.push({ key: 'align', title: `Cambia la naturaleza a ${names.nature(al.value)}`, detail: al.note ?? '', gain: points(al.delta), apply: (b) => ({ ...b, alignment: al.value }) });
    if (res.speed.wastedSp > 0)
      out.push({ key: 'speed', title: `Te sobran ${res.speed.wastedSp} puntos de Velocidad`, detail: 'Con menos sigues siendo más rápido que los mismos rivales del top. Pásalos a PS o defensas.', gain: 0 });
    return out.sort((a, b) => b.gain - a.gain);
  }, [res, names, draft?.item]);

  const applyRec = (r: Rec) => {
    if (!draft || !r.apply) return;
    setDraft(r.apply(draft));
    setApplied([...applied, r.key]);
  };

  const saveAsNew = async () => {
    if (!owner || !draft || !ob) return;
    await save('pokemon', { ...owner, builds: [...owner.builds, { id: uid(), name: `${ob.name} (mejorada)`, role: ob.role, build: draft, notes: `Build Optimizer, ${new Date().toLocaleDateString()}` }] });
    setMsg('Guardada como build nueva de este Pokémon. La original no se toca.');
  };

  if (!pokemon.length) return <Empty>No hay Pokémon disponibles.</Empty>;

  return (
    <div className="fade-up mx-auto max-w-4xl">
      <PageHeader title="Build Optimizer" subtitle="Elige un Pokémon y una de sus builds: te digo qué nota saca contra el meta y qué cambiar para mejorarla." />

      <div className="panel mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[260px_1fr]">
          <div>
            <label className="label">Pokémon</label>
            <Combobox options={speciesOptions} value={pid} onChange={setPid} placeholder="Busca un Pokémon…" />
          </div>
          <div>
            <label className="label">Build</label>
            <div className="flex flex-wrap gap-1.5">
              {owner?.builds.map((b) => (
                <button key={b.id} onClick={() => setBid(b.id)} className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm ${b.id === bid ? 'border-accent bg-accent/10 text-text' : 'border-line text-muted hover:border-line-strong'}`}>
                  <ItemIcon item={b.build.item} /> {b.name}
                </button>
              ))}
            </div>
          </div>
        </div>
        {draft && (
          <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg bg-panel-2 p-3">
            <Sprite species={draft.species} size={64} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{names.species(draft.species)}</div>
              <Types species={draft.species} small />
              <div className="mt-1 text-xs text-muted">
                {names.nature(draft.alignment)} · {names.item(draft.item) || 'sin objeto'} · {draft.moves.map(names.move).join(', ')}
              </div>
            </div>
            <button className="btn btn-primary px-5 py-2.5 text-base" disabled={busy} onClick={run}>
              {busy ? <Loader2 size={17} className="animate-spin" /> : <Wand2 size={17} />} {busy ? 'Analizando…' : 'Analizar build'}
            </button>
          </div>
        )}
      </div>

      {err && <p className="mb-3 text-sm text-bad">{err}</p>}

      {res && (
        <>
          <div className="panel mb-4 flex items-center gap-6 p-5">
            <div className="text-center">
              <div className={`font-display text-6xl leading-none font-bold ${grade(res.base.objective) >= 60 ? 'text-good' : grade(res.base.objective) >= 45 ? 'text-warn' : 'text-bad'}`}>{grade(res.base.objective)}</div>
              <div className="text-xs text-faint">de 100</div>
            </div>
            <div className="text-sm">
              <div className="font-semibold">Nota contra el top 16 del meta</div>
              <p className="text-muted">50 = empata de media con el meta. Por encima de 60 es una build fuerte; por debajo de 45 sufre contra lo más usado.</p>
              <p className="mt-1 text-xs text-faint">Gana a {res.rows.filter((r) => r.score >= 0.25).length} y pierde contra {res.rows.filter((r) => r.score <= -0.25).length} de los 16 más usados.</p>
            </div>
          </div>

          <div className="panel mb-4 p-4">
            <div className="panel-title mb-3">Qué mejorar</div>
            {recs.length === 0 ? (
              <p className="text-sm text-good">No encontré ningún cambio que la mejore: esta build ya está bien ajustada contra el meta.</p>
            ) : (
              <div className="space-y-2">
                {recs.map((r) => {
                  const done = applied.includes(r.key);
                  return (
                    <div key={r.key} className="flex items-center gap-3 rounded-lg bg-panel-2 p-3">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium">{r.title}</div>
                        <div className="text-xs text-muted">{r.detail}</div>
                        {r.note && <div className="text-[11px] text-warn">{r.note}</div>}
                      </div>
                      {r.gain > 0 && <span className="num rounded-md bg-good/15 px-2 py-0.5 text-sm font-semibold text-good">+{r.gain.toFixed(1)} pts</span>}
                      {r.apply && (
                        <button className={`btn ${done ? 'border-good text-good' : ''}`} disabled={done} onClick={() => applyRec(r)}>
                          {done ? <Check size={14} /> : null} {done ? 'Aplicado' : 'Aplicar'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            {applied.length > 0 && (
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                <button className="btn btn-primary" onClick={saveAsNew}>
                  <Save size={14} /> Guardar como build nueva
                </button>
                <button className="btn" onClick={run}>
                  Volver a analizar con los cambios
                </button>
                <span className="text-xs text-faint">Las mejoras no siempre se suman exactamente: vuelve a analizar para ver la nota final.</span>
              </div>
            )}
            {msg && <p className="mt-2 text-sm text-good">{msg}</p>}
          </div>

          <button className="btn btn-ghost mb-2" onClick={() => setShowDetails(!showDetails)}>
            <ChevronDown size={15} className={showDetails ? 'rotate-180' : ''} /> {showDetails ? 'Ocultar detalles' : 'Ver detalles (movimientos y enfrentamientos)'}
          </button>
          {showDetails && (
            <div className="mb-4 grid gap-4 md:grid-cols-2">
              <div className="panel p-4">
                <div className="panel-title mb-2">Cuánto aporta cada movimiento</div>
                {res.moves.map((m) => (
                  <div key={m.move} className="flex items-center justify-between py-0.5 text-sm">
                    <span>{names.move(m.move)}</span>
                    {m.status ? <span className="text-xs text-faint">de apoyo (no se puntúa)</span> : <span className={`num text-xs ${points(m.delta) < 0.3 ? 'text-warn' : 'text-good'}`}>{points(m.delta).toFixed(1)} pts</span>}
                  </div>
                ))}
              </div>
              <div className="panel p-4">
                <div className="panel-title mb-2">Contra el top 16 (peor primero)</div>
                <div className="grid grid-cols-2 gap-1">
                  {res.rows.map((r) => (
                    <div key={r.species} className="flex items-center gap-1.5 text-xs">
                      <Sprite species={r.species} size={22} kind="icon" />
                      <span className="flex-1 truncate">{names.species(r.species)}</span>
                      <span className={`num ${scoreColor(r.score)}`}>{signed(r.score)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      <button className="btn btn-ghost mb-2" onClick={() => setShowEditor(!showEditor)}>
        <ChevronDown size={15} className={showEditor ? 'rotate-180' : ''} /> {showEditor ? 'Ocultar editor' : 'Editar la build a mano'}
      </button>
      {showEditor && draft && (
        <div className="panel p-4">
          <BuildEditor build={draft} onChange={(b) => (setDraft(b), setRes(undefined))} />
        </div>
      )}
    </div>
  );
}
