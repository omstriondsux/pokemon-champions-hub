import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { dex, finalStats, getSpecies, learnableMoves, megaFormeOf, STAT_IDS, totalSp, validateBuild, type Build, type LegalityIssue } from '@pch/engine';
import { useApp } from '../lib/app';
import { allItems, ALIGNMENTS } from '../lib/pokemon';
import { Combobox, ItemIcon, Sprite, StatBars, Types, useNameOptions } from './ui';

const STAT_LABEL: Record<string, string> = { hp: 'PS', atk: 'Atq', def: 'Def', spa: 'AtE', spd: 'DfE', spe: 'Vel' };

export function useLegality(build: Build | undefined) {
  const { regulation } = useApp();
  const [issues, setIssues] = useState<LegalityIssue[]>([]);
  useEffect(() => {
    let live = true;
    if (build) validateBuild(build, regulation).then((i) => live && setIssues(i));
    return () => {
      live = false;
    };
  }, [build, regulation]);
  return issues;
}

export function BuildEditor({ build, onChange }: { build: Build; onChange: (b: Build) => void }) {
  const { regulation, names } = useApp();
  const species = getSpecies(build.species);
  const [learnable, setLearnable] = useState<string[]>([]);
  const issues = useLegality(build);
  const limits = regulation.pack.statPoints;

  useEffect(() => {
    learnableMoves(build.species).then((ids) => setLearnable([...ids].map((id) => dex.moves.get(id).name).filter((m) => regulation.isMoveAllowed(m)).sort()));
  }, [build.species, regulation]);

  const moveOptions = useNameOptions('moves', learnable);
  const itemOptions = useNameOptions('items', useMemo(allItems, []));
  const natureOptions = useNameOptions('natures', ALIGNMENTS);
  const mega = megaFormeOf(build);
  const statsForme = mega ?? build.species;
  const stats = useMemo(() => finalStats(statsForme, build.sp, build.alignment), [statsForme, build.sp, build.alignment]);
  const used = totalSp(build.sp);
  const left = limits.total.value - used;
  const set = (patch: Partial<Build>) => onChange({ ...build, ...patch });
  const nat = dex.natures.get(build.alignment);

  return (
    <div className="grid gap-5 md:grid-cols-[1fr_1fr]">
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <Sprite species={statsForme} size={72} />
          <div>
            <div className="font-display text-xl font-bold">{names.species(build.species)}</div>
            <Types species={statsForme} />
            {mega && <div className="mt-1 text-xs text-accent-2">Mega: {names.species(mega)}</div>}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Habilidad</label>
            <select className="input" value={build.ability} onChange={(e) => set({ ability: e.target.value })}>
              {Object.values(species?.abilities ?? {}).map((a) => (
                <option key={a} value={a}>
                  {names.ability(a)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Alineación (naturaleza)</label>
            <Combobox options={natureOptions} value={build.alignment} onChange={(v) => set({ alignment: v })} />
            {nat.plus && nat.plus !== nat.minus && (
              <div className="mt-1 text-[11px] text-faint">
                +{STAT_LABEL[nat.plus]} −{STAT_LABEL[nat.minus!]}
              </div>
            )}
          </div>
        </div>
        <div>
          <label className="label">
            Objeto <ItemIcon item={build.item} />
          </label>
          <div className="flex gap-2">
            <div className="flex-1">
              <Combobox options={itemOptions} value={build.item} onChange={(v) => set({ item: v })} placeholder="Sin objeto" />
            </div>
            {build.item && (
              <button className="btn" onClick={() => set({ item: undefined })}>
                Quitar
              </button>
            )}
          </div>
        </div>
        <div>
          <label className="label">Movimientos</label>
          <div className="grid grid-cols-2 gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Combobox
                key={i}
                options={moveOptions}
                value={build.moves[i]}
                placeholder={`Movimiento ${i + 1}`}
                onChange={(v) => {
                  const moves = [...build.moves];
                  moves[i] = v;
                  set({ moves: moves.filter(Boolean) });
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <span className="panel-title">Stat Points</span>
          <span className={`num text-sm ${left < 0 ? 'text-bad' : left === 0 ? 'text-good' : 'text-warn'}`}>
            {used}/{limits.total.value} · quedan {left}
          </span>
        </div>
        <div className="grid gap-1.5">
          {STAT_IDS.map((s) => (
            <div key={s} className="grid grid-cols-[34px_1fr_52px_44px] items-center gap-2">
              <span className="text-xs text-muted">{STAT_LABEL[s]}</span>
              <input
                type="range"
                min={0}
                max={limits.perStatMax.value}
                value={build.sp[s]}
                onChange={(e) => set({ sp: { ...build.sp, [s]: Number(e.target.value) } })}
                className="accent-[var(--accent)]"
              />
              <input
                type="number"
                min={0}
                max={limits.perStatMax.value}
                className="input num px-2 py-1 text-right"
                value={build.sp[s]}
                onChange={(e) => set({ sp: { ...build.sp, [s]: Math.max(0, Math.min(limits.perStatMax.value, Number(e.target.value) || 0)) } })}
              />
              <span className="num text-right text-sm font-semibold">{stats[s]}</span>
            </div>
          ))}
        </div>
        <StatBars stats={stats} sp={build.sp} />
        <LegalityList issues={issues} />
      </div>
    </div>
  );
}

export function LegalityList({ issues }: { issues: LegalityIssue[] }) {
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  if (!issues.length)
    return (
      <div className="flex items-center gap-1.5 text-xs text-good">
        <CheckCircle2 size={14} /> Legal en la regulación activa
      </div>
    );
  return (
    <ul className="space-y-1 text-xs">
      {errors.map((i, k) => (
        <li key={`e${k}`} className="flex gap-1.5 text-bad">
          <AlertTriangle size={14} className="shrink-0" /> {i.message}
        </li>
      ))}
      {warnings.map((i, k) => (
        <li key={`w${k}`} className="flex gap-1.5 text-warn">
          <AlertTriangle size={14} className="shrink-0" /> {i.message}
          {i.ruleConfidence && i.ruleConfidence !== 'verified' ? ` (regla ${i.ruleConfidence})` : ''}
        </li>
      ))}
    </ul>
  );
}
