import { useEffect, useMemo, useState } from 'react';
import { getSpecies, megaFormeOf, parseSpread, statValue, topEntries, type MetaSnapshot } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct, resolveTeam } from '../lib/pokemon';
import type { Mode } from '../lib/types';
import { Badge, PageHeader, Segmented, Sprite } from '../components/ui';

interface Row {
  species: string;
  label: string;
  speed: number;
  share: number; // fraction of teams running this (approx.)
  mine?: boolean;
  scarf?: boolean;
}

export default function SpeedTiers() {
  const { snapshot, settings, teams, pokemon, names, regulation } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [snap, setSnap] = useState<MetaSnapshot>();
  const [top, setTop] = useState(40);
  const [tr, setTr] = useState(false);
  const [tailwind, setTailwind] = useState<'none' | 'meta' | 'mine'>('none');
  const [q, setQ] = useState('');

  useEffect(() => {
    snapshot(mode).then(setSnap);
  }, [mode, snapshot]);

  const activeTeam = teams.find((t) => t.id === settings.activeTeam[mode]);
  const myBuilds = resolveTeam(activeTeam, pokemon).builds;

  const rows = useMemo(() => {
    const out: Row[] = [];
    if (snap) {
      for (const [name, mon] of Object.entries(snap.pokemon).sort((a, b) => b[1].usage - a[1].usage).slice(0, top)) {
        const s = getSpecies(name);
        if (!s) continue;
        const scarfP = mon.items['choicescarf'] ?? 0;
        for (const [key, p] of topEntries(mon.spreads, 3)) {
          const sp = parseSpread(key);
          if (!sp || p < 0.05) continue;
          const speed = statValue('spe', s.baseStats.spe, sp.sp.spe, sp.alignment) * (tailwind === 'meta' ? 2 : 1);
          out.push({ species: name, label: `${sp.alignment} ${sp.sp.spe} SP`, speed, share: mon.usage * p });
          if (scarfP >= 0.08) out.push({ species: name, label: `${sp.alignment} ${sp.sp.spe} SP · Scarf (${pct(scarfP)})`, speed: Math.floor(speed * 1.5), share: mon.usage * p * scarfP, scarf: true });
        }
      }
    }
    for (const b of myBuilds) {
      const forme = megaFormeOf(b) ?? b.species;
      const s = getSpecies(forme);
      if (!s) continue;
      let speed = statValue('spe', s.baseStats.spe, b.sp.spe, b.alignment);
      if (b.item === 'Choice Scarf') speed = Math.floor(speed * 1.5);
      if (tailwind === 'mine') speed *= 2;
      out.push({ species: forme, label: `${b.alignment} ${b.sp.spe} SP${b.item === 'Choice Scarf' ? ' · Scarf' : ''} · TU EQUIPO`, speed, share: 0, mine: true });
    }
    return out.sort((a, b) => (tr ? a.speed - b.speed : b.speed - a.speed));
  }, [snap, top, myBuilds, tr, tailwind]);

  const filtered = q ? rows.filter((r) => r.mine || `${r.species} ${names.species(r.species)}`.toLowerCase().includes(q.toLowerCase())) : rows;
  const max = Math.max(1, ...rows.map((r) => r.speed));

  return (
    <div className="fade-up">
      <PageHeader
        title="Speed Tiers"
        subtitle={
          snap ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              Smogon {snap.meta.month} · {snap.meta.showdownFormat} · rating ≥ {snap.meta.ratingCutoff} · <Badge level="simulator" /> Nivel 50, {regulation.id}. Las megas usan la velocidad de la forma mega.
            </span>
          ) : (
            'Sin datos de meta'
          )
        }
        actions={<Segmented value={mode} onChange={setMode} options={[{ value: 'doubles', label: 'Dobles' }, { value: 'singles', label: 'Individuales' }]} />}
      />
      <div className="panel mb-4 flex flex-wrap items-center gap-4 p-3 text-sm">
        <input className="input w-56" placeholder="Filtrar Pokémon…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="flex items-center gap-1.5">
          Top
          <select className="input w-20 py-1" value={top} onChange={(e) => setTop(Number(e.target.value))}>
            {[20, 40, 80, 150].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={tr} onChange={(e) => setTr(e.target.checked)} /> Trick Room (orden inverso)
        </label>
        <label className="flex items-center gap-1.5">
          Tailwind
          <select className="input w-36 py-1" value={tailwind} onChange={(e) => setTailwind(e.target.value as typeof tailwind)}>
            <option value="none">Nadie</option>
            <option value="meta">Rivales (×2)</option>
            <option value="mine">Mi equipo (×2)</option>
          </select>
        </label>
        {!activeTeam && <span className="text-xs text-warn">Marca un equipo activo en "Equipos" para ver tus velocidades aquí.</span>}
      </div>
      <div className="panel divide-y divide-line">
        {filtered.map((r, i) => (
          <div key={i} className={`grid grid-cols-[48px_200px_1fr_60px_70px] items-center gap-3 px-3 py-1.5 text-sm ${r.mine ? 'bg-accent/10' : ''}`}>
            <Sprite species={r.species} size={32} kind="icon" />
            <div className="min-w-0">
              <div className={`truncate ${r.mine ? 'font-semibold text-accent' : ''}`}>{names.species(r.species)}</div>
              <div className="truncate text-[11px] text-faint">{r.label}</div>
            </div>
            <div className="h-1.5 rounded-full bg-panel-2">
              <div className={`h-full rounded-full ${r.mine ? 'bg-accent' : r.scarf ? 'bg-warn' : 'bg-accent-2/70'}`} style={{ width: `${(r.speed / max) * 100}%` }} />
            </div>
            <div className="num text-right font-semibold">{r.speed}</div>
            <div className="num text-right text-[11px] text-faint">{r.mine ? '' : pct(r.share, 1)}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">% = cuota aproximada de equipos con esa combinación (uso × frecuencia del spread). Solo los 3 spreads más usados por Pokémon, si superan el 5%.</p>
    </div>
  );
}
