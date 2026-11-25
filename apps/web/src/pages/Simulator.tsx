import { useState } from 'react';
import { Loader2, Play } from 'lucide-react';
import type { SituationInput, SituationResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct, resolveTeam } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import type { Mode } from '../lib/types';
import { Combobox, Empty, PageHeader, Segmented, Sprite, useSpeciesOptions } from '../components/ui';

interface MineSlot {
  idx: number;
  hp: number;
  atk: number;
  spe: number;
  status: string;
}
interface OppSlot {
  species: string;
  hp: number;
  atk: number;
  spe: number;
  status: string;
  moves: string;
  item: string;
}

const BOOSTS = [-2, -1, 0, 1, 2, 3, 4, 5, 6];

export default function Simulator() {
  const { settings, teams, pokemon, regulation, snapshot, names } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const team = teams.find((x) => x.id === settings.activeTeam[mode]) ?? teams.find((x) => x.format === mode);
  const { builds } = resolveTeam(team, pokemon);
  const n = mode === 'doubles' ? 2 : 1;
  const [mine, setMine] = useState<MineSlot[]>([0, 1].map((i) => ({ idx: i, hp: 100, atk: 0, spe: 0, status: '' })));
  const [opps, setOpps] = useState<OppSlot[]>([0, 1].map(() => ({ species: '', hp: 100, atk: 0, spe: 0, status: '', moves: '', item: '' })));
  const [field, setField] = useState({ weather: '', terrain: '', trickRoom: false, myTailwind: false, theirTailwind: false, myReflect: false, myLightScreen: false, theirReflect: false, theirLightScreen: false });
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<SituationResult>();
  const [err, setErr] = useState<string>();
  const options = useSpeciesOptions();

  const run = async () => {
    const theirs = opps.slice(0, n).filter((o) => o.species);
    if (!theirs.length || !builds.length) return;
    setBusy(true);
    setErr(undefined);
    try {
      const s = await snapshot(mode);
      const input: SituationInput = {
        format: mode,
        mine: mine.slice(0, n).map((m) => ({ build: builds[m.idx]!, hpPercent: m.hp, boosts: { atk: m.atk, spa: m.atk, spe: m.spe }, status: m.status as never })),
        theirs: theirs.map((o) => ({ species: o.species, hpPercent: o.hp, boosts: { atk: o.atk, spa: o.atk, spe: o.spe }, status: o.status as never, reveals: { moves: o.moves.split(',').map((x) => x.trim()).filter(Boolean), item: o.item || undefined } })),
        field,
      };
      const r = await runAnalysis<{ result: SituationResult }>({ type: 'situation', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, input });
      setRes(r.result);
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!builds.length) return <Empty>Marca un equipo activo en «Equipos» para simular situaciones con tus Pokémon.</Empty>;

  return (
    <div className="fade-up">
      <PageHeader
        title="Simulador de situaciones"
        subtitle="Para práctica y análisis posterior. No lo uses durante competiciones oficiales: prohíben la asistencia externa."
      />
      <div className="mb-4 grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <div className="panel-title mb-2">Tus Pokémon en campo</div>
          {mine.slice(0, n).map((m, i) => (
            <div key={i} className="mb-2 grid grid-cols-[1fr_70px_70px_70px_80px] items-center gap-2 text-xs">
              <select className="input py-1" value={m.idx} onChange={(e) => setMine(mine.map((x, k) => (k === i ? { ...x, idx: Number(e.target.value) } : x)))}>
                {builds.map((b, k) => (
                  <option key={k} value={k}>
                    {names.species(b.species)}
                  </option>
                ))}
              </select>
              <Num label="PS%" value={m.hp} set={(v) => setMine(mine.map((x, k) => (k === i ? { ...x, hp: v } : x)))} />
              <Boost label="Ataques" value={m.atk} set={(v) => setMine(mine.map((x, k) => (k === i ? { ...x, atk: v } : x)))} />
              <Boost label="Vel" value={m.spe} set={(v) => setMine(mine.map((x, k) => (k === i ? { ...x, spe: v } : x)))} />
              <Status value={m.status} set={(v) => setMine(mine.map((x, k) => (k === i ? { ...x, status: v } : x)))} />
            </div>
          ))}
        </div>
        <div className="panel p-4">
          <div className="panel-title mb-2">Rivales en campo</div>
          {opps.slice(0, n).map((o, i) => (
            <div key={i} className="mb-3 space-y-1.5">
              <div className="grid grid-cols-[1fr_70px_70px_70px_80px] items-center gap-2 text-xs">
                <Combobox options={options} value={o.species || undefined} onChange={(v) => setOpps(opps.map((x, k) => (k === i ? { ...x, species: v } : x)))} placeholder="Especie" />
                <Num label="PS%" value={o.hp} set={(v) => setOpps(opps.map((x, k) => (k === i ? { ...x, hp: v } : x)))} />
                <Boost label="Ataques" value={o.atk} set={(v) => setOpps(opps.map((x, k) => (k === i ? { ...x, atk: v } : x)))} />
                <Boost label="Vel" value={o.spe} set={(v) => setOpps(opps.map((x, k) => (k === i ? { ...x, spe: v } : x)))} />
                <Status value={o.status} set={(v) => setOpps(opps.map((x, k) => (k === i ? { ...x, status: v } : x)))} />
              </div>
              <div className="grid grid-cols-[1fr_160px] gap-2">
                <input className="input py-1 text-xs" placeholder="Movimientos revelados (en inglés, separados por coma)" value={o.moves} onChange={(e) => setOpps(opps.map((x, k) => (k === i ? { ...x, moves: e.target.value } : x)))} />
                <input className="input py-1 text-xs" placeholder="Objeto revelado" value={o.item} onChange={(e) => setOpps(opps.map((x, k) => (k === i ? { ...x, item: e.target.value } : x)))} />
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <select className="input w-32 py-1" value={field.weather} onChange={(e) => setField({ ...field, weather: e.target.value })}>
          <option value="">Sin clima</option>
          <option value="Sun">Sol</option>
          <option value="Rain">Lluvia</option>
          <option value="Sand">Arena</option>
          <option value="Snow">Nieve</option>
        </select>
        <select className="input w-36 py-1" value={field.terrain} onChange={(e) => setField({ ...field, terrain: e.target.value })}>
          <option value="">Sin campo</option>
          <option value="Electric">Eléctrico</option>
          <option value="Grassy">Hierba</option>
          <option value="Psychic">Psíquico</option>
          <option value="Misty">Niebla</option>
        </select>
        {(
          [
            ['trickRoom', 'Trick Room'],
            ['myTailwind', 'Tailwind propio'],
            ['theirTailwind', 'Tailwind rival'],
            ['myReflect', 'Mi Reflejo'],
            ['myLightScreen', 'Mi P. Luz'],
            ['theirReflect', 'Reflejo rival'],
            ['theirLightScreen', 'P. Luz rival'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={field[k]} onChange={(e) => setField({ ...field, [k]: e.target.checked })} /> {l}
          </label>
        ))}
        <button className="btn btn-primary ml-auto" disabled={busy} onClick={run}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />} Analizar turno
        </button>
      </div>
      {err && <p className="mb-3 text-sm text-bad">{err}</p>}
      {res && (
        <div className="space-y-4">
          <div className="panel border-accent/60 p-4 text-sm">
            {res.summary.map((s, i) => (
              <p key={i}>• {s}</p>
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <div className="panel p-4">
              <div className="panel-title mb-2">Tus opciones (mejor primero)</div>
              <table className="w-full text-xs">
                <thead className="text-faint">
                  <tr>
                    <th className="text-left font-normal">Pokémon</th>
                    <th className="text-left font-normal">Movimiento</th>
                    <th className="text-left font-normal">Objetivo</th>
                    <th className="text-right font-normal">Daño</th>
                    <th className="text-right font-normal">KO</th>
                    <th className="text-right font-normal">Primero</th>
                  </tr>
                </thead>
                <tbody>
                  {res.actions
                    .filter((a) => a.target >= 0)
                    .slice(0, 14)
                    .map((a, i) => (
                      <tr key={i} className="border-t border-line" title={a.note}>
                        <td className="py-1">{names.species(builds[mine[a.user]!.idx]!.species)}</td>
                        <td>{names.move(a.move)}</td>
                        <td>{names.species(res.models[a.target]!.species)}</td>
                        <td className="num text-right">
                          {a.minPct.toFixed(0)}–{a.maxPct.toFixed(0)}%
                        </td>
                        <td className={`num text-right ${a.koChance > 0.9 ? 'text-good' : a.koChance > 0 ? 'text-warn' : 'text-faint'}`}>{pct(a.koChance)}</td>
                        <td className="num text-right">{pct(a.movesFirst)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="panel p-4">
              <div className="panel-title mb-2">Amenazas del rival</div>
              {res.threats.map((t, i) => (
                <div key={i} className="flex items-center gap-2 border-t border-line py-1 text-xs first:border-0">
                  <Sprite species={res.models[t.from]!.species} size={24} kind="icon" />
                  <span className="flex-1">
                    {names.move(t.move)} → {names.species(builds[mine[t.to]!.idx]!.species)}
                  </span>
                  <span className="num">hasta {t.maxPct.toFixed(0)}%</span>
                  <span className={`num w-14 text-right ${t.koChance > 0.5 ? 'text-bad' : 'text-muted'}`}>KO {pct(t.koChance)}</span>
                  <span className="num w-20 text-right text-faint">antes {pct(t.theyMoveFirst)}</span>
                </div>
              ))}
              <div className="mt-3 text-[11px] text-muted">
                {res.models.map((m) => (
                  <p key={m.species}>
                    {names.species(m.species)}: {m.candidates.length} builds plausibles. {m.notes.at(-1)}
                  </p>
                ))}
              </div>
            </div>
          </div>
          <div className="text-[11px] text-warn/90">
            {res.limitations.map((l, i) => (
              <p key={i}>△ {l}</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Num({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return (
    <label className="flex flex-col">
      <span className="text-[10px] text-faint">{label}</span>
      <input type="number" min={1} max={100} className="input num px-2 py-1" value={value} onChange={(e) => set(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} />
    </label>
  );
}
function Boost({ label, value, set }: { label: string; value: number; set: (v: number) => void }) {
  return (
    <label className="flex flex-col">
      <span className="text-[10px] text-faint">{label}</span>
      <select className="input px-1 py-1" value={value} onChange={(e) => set(Number(e.target.value))}>
        {BOOSTS.map((b) => (
          <option key={b} value={b}>
            {b > 0 ? `+${b}` : b}
          </option>
        ))}
      </select>
    </label>
  );
}
function Status({ value, set }: { value: string; set: (v: string) => void }) {
  return (
    <label className="flex flex-col">
      <span className="text-[10px] text-faint">Estado</span>
      <select className="input px-1 py-1" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">—</option>
        <option value="par">Paral.</option>
        <option value="brn">Quem.</option>
        <option value="psn">Env.</option>
        <option value="slp">Dorm.</option>
      </select>
    </label>
  );
}
