import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, TrendingDown, TrendingUp } from 'lucide-react';
import { archetypePresence, dex, getSpecies, parseSpread, statValue, topEntries, type MetaSnapshot } from '@pch/engine';
import { useApp } from '../lib/app';
import { api } from '../lib/api';
import { pct } from '../lib/pokemon';
import type { Mode } from '../lib/types';
import { Badge, PageHeader, Segmented, Sprite, Types } from '../components/ui';

interface Status {
  running: boolean;
  lastStart?: string;
  lastEnd?: string;
  lastExit?: number | null;
  log: string[];
  indexUpdatedAt?: string;
  autoUpdateDays: number;
}

export default function MetaIntelligence() {
  const { snapshot, previousSnapshot, settings, names, regulation } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [snap, setSnap] = useState<MetaSnapshot>();
  const [prev, setPrev] = useState<MetaSnapshot>();
  const [sel, setSel] = useState<string>();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>();

  useEffect(() => {
    snapshot(mode).then((s) => {
      setSnap(s);
      if (s) setSel((cur) => (cur && s.pokemon[cur] ? cur : Object.entries(s.pokemon).sort((a, b) => b[1].usage - a[1].usage)[0]?.[0]));
    });
    previousSnapshot(mode).then(setPrev);
  }, [mode, snapshot, previousSnapshot]);

  useEffect(() => {
    let live = true;
    const tick = () => api.metaStatus().then((s) => live && setStatus(s as Status));
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);

  const rows = useMemo(() => {
    if (!snap) return [];
    return Object.entries(snap.pokemon)
      .sort((a, b) => b[1].usage - a[1].usage)
      .map(([name, m], i) => ({ name, m, rank: i + 1, delta: prev?.pokemon[name] ? m.usage - prev.pokemon[name]!.usage : undefined }));
  }, [snap, prev]);
  const filtered = q ? rows.filter((r) => `${r.name} ${names.species(r.name)}`.toLowerCase().includes(q.toLowerCase())) : rows;
  const arche = useMemo(() => (snap ? archetypePresence(snap) : []), [snap]);
  const risers = rows.filter((r) => r.delta !== undefined && r.m.usage > 0.02).sort((a, b) => b.delta! - a.delta!).slice(0, 5);
  const fallers = rows.filter((r) => r.delta !== undefined && r.m.usage > 0.02).sort((a, b) => a.delta! - b.delta!).slice(0, 5);
  const mon = sel && snap ? snap.pokemon[sel] : undefined;

  return (
    <div className="fade-up">
      <PageHeader
        title="Meta Intelligence"
        subtitle={
          snap ? (
            <span className="inline-flex flex-wrap items-center gap-1.5">
              Smogon {snap.meta.month} · {snap.meta.showdownFormat} · rating ≥ {snap.meta.ratingCutoff} · {snap.meta.battles.toLocaleString()} combates <Badge level="simulator" /> {snap.meta.regulation !== regulation.id && <span className="text-warn">⚠ datos de {snap.meta.regulation}, no de {regulation.id}</span>}
            </span>
          ) : (
            'Sin datos'
          )
        }
      />

      <div className="mb-4 grid gap-3 lg:grid-cols-3">
        <div className="panel p-4 lg:col-span-2">
          <div className="panel-title mb-2">Arquetipos y piezas de apoyo</div>
          <p className="mb-2 text-[11px] text-faint">Presencia = Σ uso × P(lo lleva): nº esperado por equipo. Es una cota superior del % de equipos que lo tienen.</p>
          <div className="grid gap-1.5 md:grid-cols-2">
            {arche.map((a) => (
              <div key={a.archetype} className="flex items-center gap-2 text-sm">
                <span className="w-32 truncate">{a.archetype}</span>
                <div className="h-1.5 flex-1 rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, a.expectedPerTeam * 100)}%` }} />
                </div>
                <span className="num w-12 text-right text-xs">{a.expectedPerTeam.toFixed(2)}</span>
                <span className="flex w-24 gap-0.5">
                  {a.setters.slice(0, 3).map((s) => (
                    <Sprite key={s.species} species={s.species} size={22} kind="icon" />
                  ))}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-4">
          <div className="panel-title mb-2">Tendencias</div>
          {prev ? (
            <>
              <p className="mb-2 text-[11px] text-faint">
                {prev.meta.month} → {snap?.meta.month}, misma regulación ({regulation.id}).
              </p>
              {risers.map((r) => (
                <TrendRow key={r.name} name={r.name} delta={r.delta!} />
              ))}
              <div className="my-1 border-t border-line" />
              {fallers.map((r) => (
                <TrendRow key={r.name} name={r.name} delta={r.delta!} />
              ))}
            </>
          ) : (
            <p className="text-sm text-muted">Solo hay un mes de datos de {regulation.id}: las tendencias aparecerán con el siguiente mes (no se comparan meses de regulaciones distintas).</p>
          )}
          <div className="mt-3 border-t border-line pt-2 text-xs text-muted">
            {status && (
              <>
                Datos descargados: {status.indexUpdatedAt ? new Date(status.indexUpdatedAt).toLocaleString() : '—'} · auto cada {status.autoUpdateDays || '—'} días
                {status.running && <div className="text-accent">Actualizando… {status.log.at(-1)}</div>}
                {!status.running && status.lastExit != null && status.lastExit !== 0 && <div className="text-bad">La última actualización falló; se conservan los datos anteriores.</div>}
              </>
            )}
            <button className="btn mt-2" disabled={status?.running} onClick={() => api.refreshMeta().then(() => api.metaStatus().then((s) => setStatus(s as Status)))}>
              <RefreshCw size={14} className={status?.running ? 'animate-spin' : ''} /> Actualizar ahora
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="panel flex max-h-[75vh] flex-col p-3">
          <input className="input mb-2" placeholder="Buscar…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex-1 overflow-auto">
            {filtered.map((r) => (
              <button key={r.name} onClick={() => setSel(r.name)} className={`flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-sm ${sel === r.name ? 'bg-accent/15' : 'hover:bg-panel-2'}`}>
                <span className="num w-7 text-xs text-faint">{r.rank}</span>
                <Sprite species={r.name} size={28} kind="icon" />
                <span className="flex-1 truncate">{names.species(r.name)}</span>
                {r.delta !== undefined && Math.abs(r.delta) >= 0.005 && <span className={`num text-[11px] ${r.delta > 0 ? 'text-good' : 'text-bad'}`}>{(r.delta * 100).toFixed(1)}</span>}
                <span className="num w-14 text-right text-xs">{pct(r.m.usage, 1)}</span>
              </button>
            ))}
          </div>
        </div>
        {mon && sel && snap && <Detail name={sel} snap={snap} />}
      </div>
    </div>
  );
}

function TrendRow({ name, delta }: { name: string; delta: number }) {
  const { names } = useApp();
  return (
    <div className="flex items-center gap-2 text-sm">
      {delta > 0 ? <TrendingUp size={14} className="text-good" /> : <TrendingDown size={14} className="text-bad" />}
      <Sprite species={name} size={24} kind="icon" />
      <span className="flex-1 truncate">{names.species(name)}</span>
      <span className={`num text-xs ${delta > 0 ? 'text-good' : 'text-bad'}`}>
        {delta > 0 ? '+' : ''}
        {(delta * 100).toFixed(1)} pp
      </span>
    </div>
  );
}

function Detail({ name, snap }: { name: string; snap: MetaSnapshot }) {
  const { names } = useApp();
  const m = snap.pokemon[name]!;
  const s = getSpecies(name);
  const list = (rec: Record<string, number>, n: number, tr: (x: string) => string, scale = 1) =>
    topEntries(rec, n).map(([k, p]) => (
      <div key={k} className="flex items-center gap-2 text-xs">
        <span className="flex-1 truncate">{tr(k)}</span>
        <div className="h-1 w-24 rounded-full bg-panel-2">
          <div className="h-full rounded-full bg-accent-2" style={{ width: `${Math.min(100, (p / scale) * 100)}%` }} />
        </div>
        <span className="num w-12 text-right">{pct(p, 1)}</span>
      </div>
    ));
  const moveName = (id: string) => names.move(dex.moves.get(id).name || id);
  const itemName = (id: string) => names.item(dex.items.get(id).name || id);
  const abilityName = (id: string) => names.ability(dex.abilities.get(id).name || id);
  return (
    <div className="panel p-4">
      <div className="mb-4 flex items-center gap-4">
        <Sprite species={name} size={88} />
        <div>
          <div className="font-display text-2xl font-bold">{names.species(name)}</div>
          <Types species={name} />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            uso {pct(m.usage, 1)} · {m.rawCount.toLocaleString()} apariciones <Badge level={m.reliability} />
          </div>
          {s && (
            <div className="num mt-1 text-[11px] text-faint">
              Base {s.baseStats.hp}/{s.baseStats.atk}/{s.baseStats.def}/{s.baseStats.spa}/{s.baseStats.spd}/{s.baseStats.spe}
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-2">
        <Block title="Movimientos (P de llevarlo)">{list(m.moves, 12, moveName)}</Block>
        <div className="space-y-5">
          <Block title="Objetos">{list(m.items, 8, itemName)}</Block>
          <Block title="Habilidades">{list(m.abilities, 3, abilityName)}</Block>
        </div>
        <Block title="Distribuciones de Stat Points">
          {topEntries(m.spreads, 8).map(([k, p]) => {
            const sp = parseSpread(k);
            const spe = sp && s ? statValue('spe', s.baseStats.spe, sp.sp.spe, sp.alignment) : undefined;
            return (
              <div key={k} className="flex items-center gap-2 text-xs">
                <span className="num flex-1 truncate">
                  {sp ? `${names.nature(sp.alignment)} ${Object.values(sp.sp).join('/')}` : k}
                </span>
                {spe && <span className="num text-faint">Vel {spe}</span>}
                <span className="num w-12 text-right">{pct(p, 1)}</span>
              </div>
            );
          })}
        </Block>
        <Block title="Compañeros frecuentes">
          {topEntries(m.teammates, 10).map(([k, p]) => (
            <div key={k} className="flex items-center gap-2 text-xs">
              <Sprite species={k} size={22} kind="icon" />
              <span className="flex-1 truncate">{names.species(k)}</span>
              <span className="num w-12 text-right">{pct(p, 0)}</span>
            </div>
          ))}
        </Block>
        <Block title="Checks y counters (Showdown)">
          <p className="mb-1 text-[10px] text-faint">Puntuación = P(KO o cambio forzado) − 4·desviación. Datos de simulador, muestra n.</p>
          {m.checksAndCounters.slice(0, 10).map((c) => (
            <div key={c.against} className="flex items-center gap-2 text-xs">
              <Sprite species={c.against} size={22} kind="icon" />
              <span className="flex-1 truncate">{names.species(c.against)}</span>
              <span className="num text-faint">n={c.n.toFixed(0)}</span>
              <span className="num w-12 text-right">{(c.score * 100).toFixed(0)}</span>
            </div>
          ))}
        </Block>
      </div>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="panel-title mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
