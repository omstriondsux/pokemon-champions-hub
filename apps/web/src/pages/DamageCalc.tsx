import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { calcDamage, dex, finalSpeed, minBulkToSurvive, minOffenseToKO, minSpeedSp, opponentModel, type Build, type DamageResult, type OpponentModel } from '@pch/engine';
import { useApp } from '../lib/app';
import { pct } from '../lib/pokemon';
import type { Mode } from '../lib/types';
import { BuildEditor } from '../components/BuildEditor';
import { defaultBuild } from './MyPokemon';
import { Combobox, PageHeader, Segmented, Sprite, useSpeciesOptions } from '../components/ui';

type Source = { kind: 'mine'; key: string } | { kind: 'meta'; idx: number } | { kind: 'custom' };

function SidePicker({ label, build, setBuild, mode }: { label: string; build: Build; setBuild: (b: Build) => void; mode: Mode }) {
  const { pokemon, names, snapshot } = useApp();
  const speciesOptions = useSpeciesOptions();
  const [model, setModel] = useState<OpponentModel>();
  const [src, setSrc] = useState<Source>({ kind: 'custom' });
  const mine = pokemon.flatMap((p) => p.builds.map((b) => ({ key: b.id, label: `${names.species(p.species)} · ${b.name}`, build: b.build })));

  useEffect(() => {
    let live = true;
    snapshot(mode).then((s) => opponentModel(build.species, s).then((m) => live && setModel(m)));
    return () => {
      live = false;
    };
  }, [build.species, mode, snapshot]);

  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="panel-title">{label}</span>
        <div className="flex gap-2">
          {mine.length > 0 && (
            <select
              className="input w-52 py-1 text-xs"
              value={src.kind === 'mine' ? src.key : ''}
              onChange={(e) => {
                const m = mine.find((x) => x.key === e.target.value);
                if (m) (setBuild(structuredClone(m.build)), setSrc({ kind: 'mine', key: m.key }));
              }}
            >
              <option value="">Mis builds…</option>
              {mine.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
          {model && model.source === 'meta' && (
            <select
              className="input w-full max-w-60 min-w-0 py-1 text-xs"
              value={src.kind === 'meta' ? src.idx : ''}
              onChange={(e) => {
                const c = model.candidates[Number(e.target.value)];
                if (c) (setBuild(structuredClone(c.build)), setSrc({ kind: 'meta', idx: Number(e.target.value) }));
              }}
            >
              <option value="">Sets del meta…</option>
              {model.candidates.map((c, i) => (
                <option key={i} value={i}>
                  {pct(c.weight)} · {c.label.split(' · ').slice(1).join(' · ')}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="mb-3">
        <Combobox
          options={speciesOptions}
          value={build.species}
          onChange={(s) => {
            setBuild(defaultBuild(s));
            setSrc({ kind: 'custom' });
          }}
        />
      </div>
      <BuildEditor build={build} onChange={(b) => (setBuild(b), setSrc({ kind: 'custom' }))} />
    </div>
  );
}

export default function DamageCalc() {
  const { regulation, settings, names } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [atk, setAtk] = useState<Build>(() => ({ ...defaultBuild('Garchomp'), alignment: 'Jolly', moves: ['Earthquake', 'Dragon Claw', 'Rock Slide', 'Stomping Tantrum'], sp: { hp: 2, atk: 32, def: 0, spa: 0, spd: 0, spe: 32 } }));
  const [def, setDef] = useState<Build>(() => ({ ...defaultBuild('Incineroar'), moves: ['Fake Out', 'Flare Blitz'], sp: { hp: 32, atk: 0, def: 14, spa: 0, spd: 20, spe: 0 } }));
  const [field, setField] = useState({ weather: '', terrain: '', reflect: false, lightScreen: false, helpingHand: false, crit: false });
  const [boost, setBoost] = useState({ atk: 0, def: 0 });

  const fieldInput = useMemo(
    () => ({
      gameType: (mode === 'doubles' ? 'Doubles' : 'Singles') as 'Doubles' | 'Singles',
      weather: (field.weather || undefined) as never,
      terrain: (field.terrain || undefined) as never,
      defenderSide: { isReflect: field.reflect, isLightScreen: field.lightScreen } as never,
      attackerSide: { isHelpingHand: field.helpingHand } as never,
    }),
    [mode, field],
  );

  const results = useMemo(() => {
    const out: { move: string; r?: DamageResult; err?: string }[] = [];
    for (const m of atk.moves) {
      if (dex.moves.get(m).category === 'Status') continue;
      try {
        out.push({ move: m, r: calcDamage(atk, def, m, regulation, { field: fieldInput, attacker: { boosts: { atk: boost.atk, spa: boost.atk } }, defender: { boosts: { def: boost.def, spd: boost.def } }, critStage: field.crit ? 3 : 0 }) });
      } catch (e) {
        out.push({ move: m, err: String(e) });
      }
    }
    return out;
  }, [atk, def, regulation, fieldInput, boost, field.crit]);

  const spA = finalSpeed(atk, regulation);
  const spD = finalSpeed(def, regulation);

  return (
    <div className="fade-up">
      <PageHeader
        title="Calculadora de daño"
        subtitle="Motor: @smogon/calc (mecánicas de Champions). Probabilidades exactas sobre las 16 tiradas, con precisión y críticos."
        actions={
          <>
            <button
              className="btn"
              onClick={() => {
                setAtk(def);
                setDef(atk);
              }}
            >
              <ArrowLeftRight size={15} /> Intercambiar
            </button>
          </>
        }
      />

      <div className="panel mb-4 flex flex-wrap items-center gap-3 p-3 text-sm">
        <select className="input w-36 py-1" value={field.weather} onChange={(e) => setField({ ...field, weather: e.target.value })}>
          <option value="">Sin clima</option>
          <option value="Sun">Sol</option>
          <option value="Rain">Lluvia</option>
          <option value="Sand">Arena</option>
          <option value="Snow">Nieve</option>
        </select>
        <select className="input w-40 py-1" value={field.terrain} onChange={(e) => setField({ ...field, terrain: e.target.value })}>
          <option value="">Sin campo</option>
          <option value="Electric">Eléctrico</option>
          <option value="Grassy">Hierba</option>
          <option value="Psychic">Psíquico</option>
          <option value="Misty">Niebla</option>
        </select>
        {(
          [
            ['reflect', 'Reflejo'],
            ['lightScreen', 'Pantalla de luz'],
            ['helpingHand', 'Refuerzo'],
            ['crit', 'Forzar crítico'],
          ] as const
        ).map(([k, l]) => (
          <label key={k} className="flex items-center gap-1.5">
            <input type="checkbox" checked={field[k]} onChange={(e) => setField({ ...field, [k]: e.target.checked })} /> {l}
          </label>
        ))}
        <label className="flex items-center gap-1.5">
          Atq/AtE
          <select className="input w-16 py-1" value={boost.atk} onChange={(e) => setBoost({ ...boost, atk: Number(e.target.value) })}>
            {[-2, -1, 0, 1, 2, 3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>
                {v > 0 ? `+${v}` : v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5">
          Def/DfE
          <select className="input w-16 py-1" value={boost.def} onChange={(e) => setBoost({ ...boost, def: Number(e.target.value) })}>
            {[-2, -1, 0, 1, 2, 3, 4, 5, 6].map((v) => (
              <option key={v} value={v}>
                {v > 0 ? `+${v}` : v}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="panel mb-4 p-4">
        <div className="mb-3 flex items-center gap-3">
          <Sprite species={atk.species} size={44} />
          <span className="text-muted">→</span>
          <Sprite species={def.species} size={44} />
          <div className="ml-auto text-right text-xs text-muted">
            Velocidad: <span className="num text-text">{spA}</span> vs <span className="num text-text">{spD}</span> · {spA > spD ? 'atacante primero' : spA < spD ? 'defensor primero' : 'empate de velocidad (50%)'}
          </div>
        </div>
        {results.length === 0 ? (
          <p className="text-sm text-muted">El atacante no tiene movimientos de daño.</p>
        ) : (
          <div className="space-y-2">
            {results.map(({ move, r, err }) => (
              <ResultRow key={move} move={move} r={r} err={err} />
            ))}
          </div>
        )}
      </div>

      <Thresholds atk={atk} def={def} fieldInput={fieldInput} />

      <div className="grid gap-4 xl:grid-cols-2">
        <SidePicker label="Atacante" build={atk} setBuild={setAtk} mode={mode} />
        <SidePicker label="Defensor" build={def} setBuild={setDef} mode={mode} />
      </div>
    </div>
  );
}

function ResultRow({ move, r, err }: { move: string; r?: DamageResult; err?: string }) {
  const { names } = useApp();
  if (!r) return <div className="text-xs text-bad">{names.move(move)}: {err}</div>;
  const [o1, o2, o3] = r.koChance;
  const ko = o1 >= 0.999 ? 'OHKO garantizado' : o1 > 0 ? `${pct(o1, 1)} OHKO` : o2 >= 0.999 ? '2HKO garantizado' : o2 > 0 ? `${pct(o2, 1)} 2HKO` : o3 > 0 ? `${pct(o3, 1)} 3HKO` : 'no KO en 3';
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[150px_1fr_170px] rounded-lg bg-panel-2 px-3 py-2">
      <div className="font-medium">{names.move(r.move)}</div>
      <div className="order-last col-span-2 min-w-0 sm:order-none sm:col-span-1">
        <div className="relative h-2.5 overflow-hidden rounded-full bg-bg">
          <div className="absolute h-full bg-accent/35" style={{ width: `${Math.min(100, r.maxPct)}%` }} />
          <div className="absolute h-full bg-accent" style={{ width: `${Math.min(100, r.minPct)}%` }} />
        </div>
        <div className="mt-1 flex flex-wrap justify-between gap-x-2 text-[11px] text-faint">
          <span className="num">
            {r.min}–{r.max} ({r.minPct.toFixed(1)}–{r.maxPct.toFixed(1)}%)
          </span>
          <span>
            precisión {pct(r.accuracy)} · crítico {pct(r.critChance, 1)} · esperado {((r.expected / r.defenderHP) * 100).toFixed(1)}%
          </span>
        </div>
      </div>
      <div className={`text-right text-sm font-semibold ${o1 >= 0.5 ? 'text-good' : o2 >= 0.5 ? 'text-warn' : 'text-muted'}`} title={r.description}>
        {ko}
      </div>
    </div>
  );
}

function Thresholds({ atk, def, fieldInput }: { atk: Build; def: Build; fieldInput: object }) {
  const { regulation, names } = useApp();
  const moves = atk.moves.filter((m) => dex.moves.get(m).category !== 'Status');
  const [move, setMove] = useState(moves[0] ?? '');
  useEffect(() => {
    if (!moves.includes(move)) setMove(moves[0] ?? '');
  }, [moves, move]);
  const out = useMemo(() => {
    if (!move) return undefined;
    const opts = { field: fieldInput as never };
    const speed = minSpeedSp({ ...atk, sp: { ...atk.sp, spe: 0 } }, regulation, finalSpeed(def, regulation));
    const bulk = minBulkToSurvive(atk, def, move, regulation, opts);
    const off = minOffenseToKO(atk, def, move, regulation, opts);
    const off2 = minOffenseToKO(atk, def, move, regulation, { ...opts, hits: 2 });
    return { speed, bulk, off, off2 };
  }, [atk, def, move, regulation, fieldInput]);

  return (
    <div className="panel mb-4 p-4">
      <div className="mb-3 flex items-center gap-3">
        <span className="panel-title">Umbrales de Stat Points</span>
        <select className="input w-48 py-1 text-sm" value={move} onChange={(e) => setMove(e.target.value)}>
          {moves.map((m) => (
            <option key={m} value={m}>
              {names.move(m)}
            </option>
          ))}
        </select>
      </div>
      {out && (
        <div className="grid gap-3 text-sm md:grid-cols-3">
          <Tile title="Atacante: velocidad para superar al defensor">
            {out.speed ? (
              <>
                <b className="num">{out.speed.sp} SP</b> en Vel → {out.speed.speed}
                {out.speed.tieOnly ? ' (solo empata)' : ''}. Tienes {atk.sp.spe}
                {atk.sp.spe > out.speed.sp && !out.speed.tieOnly ? <span className="text-warn"> · sobran {atk.sp.spe - out.speed.sp} contra este rival</span> : ''}
              </>
            ) : (
              <span className="text-bad">Imposible con esta alineación</span>
            )}
          </Tile>
          <Tile title={`Defensor: bulk mínimo para aguantar ${names.move(move)}`}>
            {out.bulk ? (
              <>
                <b className="num">
                  {out.bulk.hp} PS + {out.bulk.def} {out.bulk.defStat === 'def' ? 'Def' : 'DfE'}
                </b>{' '}
                ({out.bulk.totalUsed} SP) para sobrevivir siempre
              </>
            ) : (
              <span className="text-bad">No sobrevive ni con inversión máxima</span>
            )}
          </Tile>
          <Tile title="Atacante: ofensiva mínima para el KO">
            {out.off ? (
              <>
                OHKO garantizado con <b className="num">{out.off.sp} SP</b> en {out.off.stat === 'atk' ? 'Atq' : 'AtE'}
              </>
            ) : out.off2 ? (
              <>
                Sin OHKO posible; 2HKO garantizado con <b className="num">{out.off2.sp} SP</b>
              </>
            ) : (
              <span className="text-muted">Sin KO garantizado en 2 usos</span>
            )}
          </Tile>
        </div>
      )}
      <p className="mt-2 text-[11px] text-faint">Búsqueda exhaustiva: cambia solo las estadísticas indicadas y mantiene las demás. Garantizado = 100% de las 16 tiradas, suponiendo que el movimiento acierta y sin crítico (convención estándar).</p>
    </div>
  );
}

function Tile({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-panel-2 p-3">
      <div className="mb-1 text-xs text-muted">{title}</div>
      <div>{children}</div>
    </div>
  );
}

