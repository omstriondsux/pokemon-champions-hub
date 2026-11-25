import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useApp } from '../lib/app';
import { resolveTeam } from '../lib/pokemon';
import { uid, type BattleRecord, type Mode } from '../lib/types';
import { PREFILL_KEY } from './BattleAdvisor';
import { Combobox, Empty, Modal, PageHeader, Segmented, Sprite, useSpeciesOptions } from '../components/ui';

/** Wilson score interval: honest uncertainty for small samples. */
export function wilson(wins: number, n: number, z = 1.96): [number, number] {
  if (n === 0) return [0, 1];
  const p = wins / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const m = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - m) / d, (c + m) / d];
}

const MIN_N = 5;

interface Agg {
  key: string;
  label: string;
  species?: string;
  w: number;
  n: number;
}

function aggregate(items: { key: string; label: string; species?: string; win: boolean }[]): Agg[] {
  const m = new Map<string, Agg>();
  for (const it of items) {
    const a = m.get(it.key) ?? { key: it.key, label: it.label, species: it.species, w: 0, n: 0 };
    a.n++;
    if (it.win) a.w++;
    m.set(it.key, a);
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

export default function BattleHistory() {
  const { battles, t, remove, settings, teams, pokemon, regulation } = useApp();
  const [mode, setMode] = useState<Mode | 'all'>('all');
  const [editing, setEditing] = useState<BattleRecord>();

  const blank = (pre: Partial<BattleRecord> = {}): BattleRecord => {
    const format: Mode = pre.format ?? settings.defaultMode;
    const teamId = pre.teamId ?? settings.activeTeam[format] ?? null;
    const team = teams.find((x) => x.id === teamId);
    return {
      id: uid(),
      date: new Date().toISOString().slice(0, 16),
      regulation: regulation.id,
      format,
      teamId,
      myTeam: resolveTeam(team, pokemon).builds,
      mySelection: pre.mySelection ?? [],
      myLeads: pre.myLeads ?? [],
      opponentTeam: pre.opponentTeam ?? [],
      opponentSelection: [],
      opponentReveals: {},
      result: 'win',
      reason: '',
      mistakes: [],
      notes: '',
      advisorFollowed: pre.advisorFollowed ?? null,
    };
  };

  useEffect(() => {
    if (!window.location.hash.includes('new=1')) return;
    const raw = sessionStorage.getItem(PREFILL_KEY);
    sessionStorage.removeItem(PREFILL_KEY);
    setEditing(blank(raw ? JSON.parse(raw) : {}));
    history.replaceState(null, '', '#/history');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const list = battles.filter((b) => mode === 'all' || b.format === mode).sort((a, b) => b.date.localeCompare(a.date));
  const stats = useMemo(() => {
    const mine = aggregate(list.flatMap((b) => b.mySelection.map((i) => b.myTeam[i]).filter(Boolean).map((p) => ({ key: p!.species, label: p!.species, species: p!.species, win: b.result === 'win' }))));
    const opp = aggregate(list.flatMap((b) => b.opponentTeam.map((s) => ({ key: s, label: s, species: s, win: b.result === 'win' }))));
    const leads = aggregate(
      list
        .filter((b) => b.myLeads.length)
        .map((b) => {
          const names = b.myLeads.map((i) => b.myTeam[i]?.species ?? '?').sort();
          return { key: names.join('+'), label: names.join(' + '), win: b.result === 'win' };
        }),
    );
    const followed = aggregate(list.filter((b) => b.advisorFollowed).map((b) => ({ key: b.advisorFollowed!, label: b.advisorFollowed!, win: b.result === 'win' })));
    const mistakes = aggregate(list.flatMap((b) => b.mistakes.map((m) => ({ key: m.toLowerCase(), label: m, win: false }))));
    return { mine, opp, leads, followed, mistakes };
  }, [list]);
  const wins = list.filter((b) => b.result === 'win').length;
  const [lo, hi] = wilson(wins, list.length);

  return (
    <div className="fade-up">
      <PageHeader
        title={t('nav.history')}
        subtitle={list.length ? `${list.length} combates · ${wins} victorias · tasa ${((wins / list.length) * 100).toFixed(0)}% (IC95% ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%)` : 'Registra tus combates para detectar patrones.'}
        actions={
          <>
            <Segmented value={mode} onChange={setMode} options={[{ value: 'all', label: 'Todos' }, { value: 'doubles', label: t('mode.doubles') }, { value: 'singles', label: t('mode.singles') }]} />
            <button className="btn btn-primary" onClick={() => setEditing(blank())}>
              <Plus size={15} /> Registrar
            </button>
          </>
        }
      />
      {list.length === 0 ? (
        <Empty>Aún no hay combates. Desde el Battle Advisor puedes registrar uno con la selección ya rellenada.</Empty>
      ) : (
        <>
          <p className="mb-3 text-xs text-faint">Los porcentajes con menos de {MIN_N} combates se muestran atenuados: con tan pocos datos el intervalo de confianza es demasiado ancho para sacar conclusiones.</p>
          <div className="mb-5 grid gap-3 lg:grid-cols-3">
            <StatTable title="Mis Pokémon (seleccionados)" rows={stats.mine} />
            <StatTable title="Contra estos rivales" rows={stats.opp} hint="tu tasa de victoria cuando aparecen" />
            <StatTable title="Leads" rows={stats.leads} />
            <StatTable title="¿Seguiste al Advisor?" rows={stats.followed.map((r) => ({ ...r, label: { best: 'Mejor general', conservative: 'Conservadora', aggressive: 'Agresiva', own: 'Propia' }[r.key] ?? r.key }))} />
            <StatTable title="Errores recurrentes" rows={stats.mistakes} countOnly />
          </div>
          <div className="panel divide-y divide-line">
            {list.map((b) => (
              <div key={b.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-panel-2" onClick={() => setEditing(structuredClone(b))}>
                <span className={`w-16 text-xs font-bold uppercase ${b.result === 'win' ? 'text-good' : b.result === 'loss' ? 'text-bad' : 'text-warn'}`}>{t(`result.${b.result}`)}</span>
                <span className="num w-32 text-xs text-faint">{b.date.replace('T', ' ')}</span>
                <span className="flex gap-0.5">
                  {b.mySelection.map((i) => (
                    <Sprite key={i} species={b.myTeam[i]?.species ?? ''} size={28} kind="icon" />
                  ))}
                </span>
                <span className="text-faint">vs</span>
                <span className="flex gap-0.5">
                  {b.opponentTeam.map((s) => (
                    <Sprite key={s} species={s} size={28} kind="icon" />
                  ))}
                </span>
                <span className="flex-1 truncate text-xs text-muted">{b.reason}</span>
                <button className="btn btn-ghost p-1 text-faint hover:text-bad" onClick={(e) => (e.stopPropagation(), confirm('¿Eliminar este combate?') && remove('battles', b.id))}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
      {editing && <BattleEditor value={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function StatTable({ title, rows, hint, countOnly }: { title: string; rows: Agg[]; hint?: string; countOnly?: boolean }) {
  const { names } = useApp();
  return (
    <div className="panel p-3">
      <div className="panel-title mb-2">{title}</div>
      {hint && <p className="-mt-1 mb-2 text-[11px] text-faint">{hint}</p>}
      {rows.length === 0 ? (
        <p className="text-xs text-faint">Sin datos.</p>
      ) : (
        <div className="space-y-1">
          {rows.slice(0, 8).map((r) => {
            const [lo, hi] = wilson(r.w, r.n);
            const small = r.n < MIN_N;
            return (
              <div key={r.key} className={`flex items-center gap-2 text-xs ${small ? 'opacity-50' : ''}`}>
                {r.species && <Sprite species={r.species} size={24} kind="icon" />}
                <span className="flex-1 truncate">{r.species ? names.species(r.species) : r.label}</span>
                {countOnly ? (
                  <span className="num">{r.n}×</span>
                ) : (
                  <span className="num" title={`IC95% ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%`}>
                    {r.w}/{r.n} · {((r.w / r.n) * 100).toFixed(0)}%
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BattleEditor({ value, onClose }: { value: BattleRecord; onClose: () => void }) {
  const { teams, pokemon, save, names, t } = useApp();
  const [b, setB] = useState(value);
  const options = useSpeciesOptions();
  const modeTeams = teams.filter((x) => x.format === b.format);
  const toggle = (arr: number[], i: number) => (arr.includes(i) ? arr.filter((x) => x !== i) : [...arr, i]);
  const [mistake, setMistake] = useState('');

  return (
    <Modal title="Registrar combate" onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Fecha</label>
          <input type="datetime-local" className="input" value={b.date} onChange={(e) => setB({ ...b, date: e.target.value })} />
        </div>
        <div>
          <label className="label">Formato</label>
          <select className="input" value={b.format} onChange={(e) => setB({ ...b, format: e.target.value as Mode })}>
            <option value="doubles">Dobles</option>
            <option value="singles">Individuales</option>
          </select>
        </div>
        <div>
          <label className="label">Equipo</label>
          <select
            className="input"
            value={b.teamId ?? ''}
            onChange={(e) => {
              const team = teams.find((x) => x.id === e.target.value);
              setB({ ...b, teamId: team?.id ?? null, myTeam: resolveTeam(team, pokemon).builds, mySelection: [], myLeads: [] });
            }}
          >
            <option value="">—</option>
            {modeTeams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Resultado</label>
          <select className="input" value={b.result} onChange={(e) => setB({ ...b, result: e.target.value as BattleRecord['result'] })}>
            {(['win', 'loss', 'draw'] as const).map((r) => (
              <option key={r} value={r}>
                {t(`result.${r}`)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mb-4 grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">Tu selección (clic) y leads (doble clic / botón)</div>
          <div className="grid grid-cols-3 gap-1.5">
            {b.myTeam.map((m, i) => {
              const sel = b.mySelection.includes(i);
              const lead = b.myLeads.includes(i);
              return (
                <div key={i} className={`rounded-lg border p-1.5 text-center text-xs ${sel ? 'border-accent bg-accent/10' : 'border-line'}`}>
                  <button className="w-full" onClick={() => setB({ ...b, mySelection: toggle(b.mySelection, i), myLeads: sel ? b.myLeads.filter((x) => x !== i) : b.myLeads })}>
                    <Sprite species={m.species} size={40} className="mx-auto" />
                    <div className="truncate">{names.species(m.species)}</div>
                  </button>
                  {sel && (
                    <button className={`mt-1 rounded px-1.5 text-[10px] font-bold uppercase ${lead ? 'bg-accent text-white' : 'text-faint'}`} onClick={() => setB({ ...b, myLeads: toggle(b.myLeads, i) })}>
                      lead
                    </button>
                  )}
                </div>
              );
            })}
            {b.myTeam.length === 0 && <p className="col-span-3 text-xs text-faint">Elige un equipo.</p>}
          </div>
        </div>
        <div>
          <div className="label">Equipo rival ({b.opponentTeam.length}/6) — clic para marcar los que sacó</div>
          {b.opponentTeam.length < 6 && <Combobox options={options} onChange={(s) => !b.opponentTeam.includes(s) && setB({ ...b, opponentTeam: [...b.opponentTeam, s] })} placeholder="Añadir rival…" clearOnSelect />}
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {b.opponentTeam.map((s) => {
              const brought = b.opponentSelection.includes(s);
              return (
                <div key={s} className={`relative rounded-lg border p-1.5 text-center text-xs ${brought ? 'border-bad/60 bg-bad/10' : 'border-line'}`}>
                  <button className="w-full" onClick={() => setB({ ...b, opponentSelection: brought ? b.opponentSelection.filter((x) => x !== s) : [...b.opponentSelection, s] })}>
                    <Sprite species={s} size={40} className="mx-auto" />
                    <div className="truncate">{names.species(s)}</div>
                  </button>
                  <button className="absolute top-0.5 right-1 text-faint hover:text-bad" onClick={() => setB({ ...b, opponentTeam: b.opponentTeam.filter((x) => x !== s), opponentSelection: b.opponentSelection.filter((x) => x !== s) })}>
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mb-3">
        <label className="label">Builds rivales reveladas (opcional): movimientos, objeto y habilidad vistos</label>
        <div className="grid gap-1.5 md:grid-cols-2">
          {b.opponentSelection.map((s) => {
            const r = b.opponentReveals[s] ?? { moves: [] };
            return (
              <div key={s} className="flex items-center gap-2">
                <Sprite species={s} size={28} kind="icon" />
                <input
                  className="input py-1 text-xs"
                  placeholder="Movimientos separados por coma"
                  value={r.moves.join(', ')}
                  onChange={(e) => setB({ ...b, opponentReveals: { ...b.opponentReveals, [s]: { ...r, moves: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) } } })}
                />
                <input className="input w-32 py-1 text-xs" placeholder="Objeto" value={r.item ?? ''} onChange={(e) => setB({ ...b, opponentReveals: { ...b.opponentReveals, [s]: { ...r, item: e.target.value || undefined } } })} />
              </div>
            );
          })}
          {b.opponentSelection.length === 0 && <p className="text-xs text-faint">Marca primero qué Pokémon sacó el rival.</p>}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="label">Motivo probable del resultado</label>
          <input className="input" value={b.reason} onChange={(e) => setB({ ...b, reason: e.target.value })} placeholder="p. ej. perdí el control de velocidad tras Trick Room" />
        </div>
        <div>
          <label className="label">Errores estratégicos</label>
          <div className="flex gap-2">
            <input className="input" value={mistake} onChange={(e) => setMistake(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && mistake.trim() && (setB({ ...b, mistakes: [...b.mistakes, mistake.trim()] }), setMistake(''))} placeholder="Escribe y Enter" />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {b.mistakes.map((m, i) => (
              <span key={i} className="chip">
                {m}
                <button onClick={() => setB({ ...b, mistakes: b.mistakes.filter((_, k) => k !== i) })}>×</button>
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-3">
        <label className="label">Observaciones</label>
        <textarea className="input h-16" value={b.notes} onChange={(e) => setB({ ...b, notes: e.target.value })} />
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await save('battles', b);
            onClose();
          }}
        >
          Guardar
        </button>
      </div>
    </Modal>
  );
}
