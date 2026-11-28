import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { makeBuild, type Build } from '@pch/engine';
import { useApp } from '../lib/app';
import type { Mode } from '../lib/types';
import { BuildEditor } from './BuildEditor';
import { Combobox, ItemIcon, Sprite, useSpeciesOptions } from './ui';

/**
 * Edit a 6-Pokémon team in place: pick any Pokémon, start from one of its saved/meta builds,
 * then change item, ability, moves, nature and Stat Points. Used for your team and the rival's.
 */
export function TeamEditor({ team, onChange, mode, max = 6 }: { team: Build[]; onChange: (t: Build[]) => void; mode: Mode; max?: number }) {
  const { pokemon, names } = useApp();
  const [open, setOpen] = useState<number | undefined>(team.length ? 0 : undefined);
  const speciesOptions = useSpeciesOptions();
  const tag = mode === 'singles' ? '-s' : '-d';

  /** Builds available for a species: yours first, then the meta ones from the catalog. */
  const buildsOf = (species: string) => {
    const owned = pokemon.filter((p) => p.species === species);
    const list = owned.flatMap((p) => p.builds.map((b) => ({ id: b.id, label: `${p.source === 'catalog' ? 'Meta' : 'Tuya'} · ${b.name}`, build: b.build, mine: p.source !== 'catalog' })));
    return list.sort((a, b) => Number(b.mine) - Number(a.mine) || Number(b.id.includes(tag)) - Number(a.id.includes(tag)));
  };
  const defaultBuild = (species: string): Build =>
    structuredClone(buildsOf(species)[0]?.build) ?? makeBuild({ species, ability: '', alignment: 'Serious', moves: [], sp: {} });

  const set = (i: number, b: Build) => onChange(team.map((x, k) => (k === i ? b : x)));
  const taken = useMemo(() => new Set(team.map((b) => b.species)), [team]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {team.map((b, i) => (
          <button key={i} onClick={() => setOpen(open === i ? undefined : i)} className={`flex items-center gap-2 rounded-lg border p-2 text-left ${open === i ? 'border-accent bg-accent/10' : 'border-line hover:bg-panel-2'}`}>
            <Sprite species={b.species} size={36} kind="icon" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{names.species(b.species)}</span>
              <span className="flex items-center gap-1 truncate text-[11px] text-faint">
                <ItemIcon item={b.item} /> {names.item(b.item) || 'sin objeto'}
              </span>
            </span>
            <Pencil size={13} className="text-faint" />
          </button>
        ))}
        {team.length < max && (
          <div className="rounded-lg border border-dashed border-line p-1.5">
            <Combobox
              options={speciesOptions.filter((o) => !taken.has(o.value))}
              placeholder="+ Añadir Pokémon"
              clearOnSelect
              onChange={(sp) => {
                onChange([...team, defaultBuild(sp)]);
                setOpen(team.length);
              }}
            />
          </div>
        )}
      </div>

      {open !== undefined && team[open] && (
        <div className="mt-3 rounded-xl border border-line bg-panel-2/40 p-3">
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <div className="min-w-48 flex-1">
              <div className="mb-1 text-xs text-muted">Pokémon</div>
              <Combobox options={speciesOptions.filter((o) => o.value === team[open]!.species || !taken.has(o.value))} value={team[open]!.species} onChange={(sp) => set(open, defaultBuild(sp))} />
            </div>
            <div className="min-w-48 flex-1">
              <div className="mb-1 text-xs text-muted">Empezar desde una build</div>
              <select
                className="input"
                value=""
                onChange={(e) => {
                  const b = buildsOf(team[open]!.species).find((x) => x.id === e.target.value);
                  if (b) set(open, structuredClone(b.build));
                }}
              >
                <option value="">Elegir build guardada o del meta…</option>
                {buildsOf(team[open]!.species).map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.label}
                  </option>
                ))}
              </select>
            </div>
            <button
              className="btn text-bad"
              onClick={() => {
                onChange(team.filter((_, k) => k !== open));
                setOpen(undefined);
              }}
            >
              <Trash2 size={14} /> Quitar
            </button>
          </div>
          <BuildEditor build={team[open]!} onChange={(b) => set(open, b)} />
        </div>
      )}
      {team.length === 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-sm text-muted">
          <Plus size={14} /> Añade hasta {max} Pokémon. Cada uno empieza con su build más usada; luego cámbiale lo que quieras.
        </p>
      )}
    </div>
  );
}
