import { useMemo, useState } from 'react';
import { ClipboardPaste, Copy, Plus, Star, Trash2 } from 'lucide-react';
import { exportPaste, getSpecies, importPaste, makeBuild, type Build } from '@pch/engine';
import { useApp } from '../lib/app';
import { uid, type OwnedBuild, type OwnedPokemon, type PokemonStatus } from '../lib/types';
import { BuildEditor, useLegality } from '../components/BuildEditor';
import { Combobox, Empty, ItemIcon, Modal, PageHeader, Sprite, Types, useSpeciesOptions } from '../components/ui';

const STATUSES: PokemonStatus[] = ['available', 'pending_recruit', 'temporary', 'pending_training', 'transferable', 'unavailable'];
const STATUS_DOT: Record<PokemonStatus, string> = {
  available: 'bg-good',
  pending_recruit: 'bg-accent-2',
  temporary: 'bg-warn',
  pending_training: 'bg-accent',
  transferable: 'bg-faint',
  unavailable: 'bg-bad',
};

export function defaultBuild(species: string): Build {
  const s = getSpecies(species)!;
  const physical = s.baseStats.atk >= s.baseStats.spa;
  return makeBuild({ species: s.name, ability: s.abilities[0], alignment: physical ? 'Adamant' : 'Modest', moves: [], sp: {} });
}

export const newOwned = (species: string): OwnedPokemon => ({
  id: uid(),
  species,
  nickname: '',
  status: 'available',
  favorite: false,
  trainable: true,
  modificationCost: null,
  notes: '',
  builds: [{ id: uid(), name: 'Build 1', role: '', build: defaultBuild(species), notes: '' }],
});

export default function MyPokemon() {
  const { pokemon, t, names, save, remove, settings, catalogReady } = useApp();
  const ownAll = settings.ownAll;
  const [editing, setEditing] = useState<OwnedPokemon>();
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<'all' | 'favorites' | 'edited' | PokemonStatus>('all');
  const [q, setQ] = useState('');
  const [shown, setShown] = useState(48);

  const list = useMemo(
    () =>
      pokemon
        .filter((p) => (filter === 'all' ? true : filter === 'favorites' ? p.favorite : filter === 'edited' ? p.source !== 'catalog' : p.status === filter))
        .filter((p) => !q || `${p.species} ${names.species(p.species)} ${p.nickname}`.toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (ownAll ? (b.usage ?? 0) - (a.usage ?? 0) : 0) || a.species.localeCompare(b.species)),
    [pokemon, filter, q, names, ownAll],
  );
  const edited = pokemon.filter((p) => p.source !== 'catalog').length;
  const copyAll = () => navigator.clipboard.writeText(exportPaste(pokemon.filter((p) => p.source !== 'catalog' || p.favorite).flatMap((p) => p.builds.map((b) => b.build))));
  const filters: ('all' | 'favorites' | 'edited' | PokemonStatus)[] = ownAll ? ['all', 'favorites', 'edited'] : ['all', 'favorites', ...STATUSES];

  return (
    <div className="fade-up">
      <PageHeader
        title={ownAll ? 'Pokémon' : t('nav.mypokemon')}
        subtitle={
          ownAll
            ? `Tienes los ${pokemon.length} Pokémon de la regulación, cada uno con sus builds más usadas del meta. Pulsa cualquiera para ver o ajustar sus builds: tus cambios se guardan como tuyos.`
            : `${pokemon.length} Pokémon · ${pokemon.reduce((s, p) => s + p.builds.length, 0)} builds`
        }
        actions={
          <>
            <button className="btn" onClick={() => setImporting(true)}>
              <ClipboardPaste size={15} /> Importar builds (Showdown)
            </button>
            <button className="btn" onClick={copyAll} disabled={!pokemon.length} title={ownAll ? 'Copia tus favoritos y builds editadas' : undefined}>
              <Copy size={15} /> {ownAll ? 'Copiar mis builds' : 'Copiar todo'}
            </button>
            {!ownAll && (
              <button className="btn btn-primary" onClick={() => setAdding(true)}>
                <Plus size={15} /> {t('common.add')}
              </button>
            )}
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input max-w-60" placeholder={t('common.search')} value={q} onChange={(e) => (setQ(e.target.value), setShown(48))} autoFocus />
        {filters.map((f) => (
          <button key={f} onClick={() => (setFilter(f), setShown(48))} className={`chip cursor-pointer ${filter === f ? 'border-accent text-text' : ''}`}>
            {f === 'all' ? 'Todos' : f === 'favorites' ? '★ Favoritos' : f === 'edited' ? `✎ Editados (${edited})` : t(`status.${f}`)}
          </button>
        ))}
        {ownAll && <span className="ml-auto text-xs text-faint">Ordenados por uso en el meta · ★ marca tus favoritos</span>}
      </div>

      {!catalogReady ? (
        <Empty>Preparando el catálogo con las builds del meta…</Empty>
      ) : list.length === 0 ? (
        <Empty>
          {pokemon.length === 0 ? (
            <>
              Tu inventario está vacío. Añade tus Pokémon o activa «Tengo todos los Pokémon» en Ajustes.
              <div className="mt-3 flex justify-center gap-2">
                <button className="btn btn-primary" onClick={() => setAdding(true)}>
                  <Plus size={15} /> Añadir Pokémon
                </button>
              </div>
            </>
          ) : (
            'Ningún Pokémon coincide con el filtro.'
          )}
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
            {list.slice(0, shown).map((p) => (
              <PokemonCard key={p.id} p={p} onOpen={() => setEditing(structuredClone(p))} onFav={() => save('pokemon', { ...p, favorite: !p.favorite })} />
            ))}
          </div>
          {list.length > shown && (
            <div className="mt-4 text-center">
              <button className="btn" onClick={() => setShown(shown + 96)}>
                Mostrar más ({list.length - shown} restantes)
              </button>
            </div>
          )}
        </>
      )}

      {adding && <AddModal onClose={() => setAdding(false)} onPick={(s) => (setAdding(false), setEditing(newOwned(s)))} />}
      {importing && <ImportModal onClose={() => setImporting(false)} />}
      {editing && (
        <EditModal
          value={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (p) => {
            await save('pokemon', p);
            setEditing(undefined);
          }}
          onDelete={
            editing.source === 'catalog'
              ? undefined
              : async () => {
                  const msg = editing.source === 'edited' ? `¿Descartar tus cambios en ${editing.species} y volver a las builds del meta?` : `¿Eliminar ${editing.species} y sus ${editing.builds.length} builds?`;
                  if (confirm(msg)) {
                    await remove('pokemon', editing.id);
                    setEditing(undefined);
                  }
                }
          }
          deleteLabel={editing.source === 'edited' ? 'Restaurar builds del meta' : undefined}
        />
      )}
    </div>
  );
}

function PokemonCard({ p, onOpen, onFav }: { p: OwnedPokemon; onOpen: () => void; onFav: () => void }) {
  const { names, t } = useApp();
  const first = p.source === 'catalog' ? undefined : p.builds[0]?.build;
  const issues = useLegality(first);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <div className="panel group relative cursor-pointer p-3 transition-colors hover:border-accent/50" onClick={onOpen}>
      <button
        className={`absolute top-2 right-2 rounded p-1 ${p.favorite ? 'text-warn' : 'text-faint opacity-0 group-hover:opacity-100'}`}
        onClick={(e) => (e.stopPropagation(), onFav())}
        aria-label="Favorito"
      >
        <Star size={16} fill={p.favorite ? 'currentColor' : 'none'} />
      </button>
      <div className="flex items-center gap-3">
        <Sprite species={p.species} size={64} />
        <div className="min-w-0">
          <div className="truncate font-semibold">{p.nickname || names.species(p.species)}</div>
          <Types species={p.species} small />
          {p.source === 'catalog' || p.source === 'edited' ? (
            <div className="mt-1 text-[11px] text-muted">
              {p.usage ? `${(p.usage * 100).toFixed(1)}% de uso` : 'poco usado'}
              {p.source === 'edited' && <span className="ml-1.5 text-accent">· ✎ editado</span>}
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted">
              <span className={`h-2 w-2 rounded-full ${STATUS_DOT[p.status]}`} />
              {t(`status.${p.status}`)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
        {p.builds.slice(0, 3).map((b) => (
          <div key={b.id} className="flex items-center gap-1.5 truncate">
            <ItemIcon item={b.build.item} />
            <span className="text-text">{b.name}</span>
            <span className="truncate text-faint">· {b.build.moves.map(names.move).join(', ') || 'sin movimientos'}</span>
          </div>
        ))}
        {p.builds.length > 3 && <div className="text-faint">+{p.builds.length - 3} builds</div>}
        {errors > 0 && <div className="text-bad">⚠ {errors} problema(s) de legalidad</div>}
      </div>
    </div>
  );
}

function AddModal({ onClose, onPick }: { onClose: () => void; onPick: (s: string) => void }) {
  const options = useSpeciesOptions();
  return (
    <Modal title="Añadir Pokémon" onClose={onClose}>
      <Combobox options={options} onChange={onPick} placeholder="Escribe el nombre (ES o EN) y pulsa Enter" autoFocus clearOnSelect />
      <p className="mt-3 text-xs text-muted">Solo aparecen especies del roster de Champions. Las megaevoluciones se registran como la especie base con su megapiedra.</p>
    </Modal>
  );
}

function ImportModal({ onClose }: { onClose: () => void }) {
  const { pokemon, save } = useApp();
  const [text, setText] = useState('');
  const parsed = useMemo(() => (text.trim() ? importPaste(text) : undefined), [text]);
  const apply = async () => {
    if (!parsed) return;
    for (const b of parsed.builds) {
      const existing = pokemon.find((p) => p.species === b.species);
      const ob: OwnedBuild = { id: uid(), name: `Importado ${new Date().toLocaleDateString()}`, role: '', build: b, notes: '' };
      if (existing) await save('pokemon', { ...existing, builds: [...existing.builds, ob] });
      else await save('pokemon', { ...newOwned(b.species), builds: [ob] });
    }
    onClose();
  };
  return (
    <Modal title="Importar desde Showdown" onClose={onClose} wide>
      <textarea className="input num h-72 text-xs" placeholder={'Garchomp @ Life Orb\nAbility: Rough Skin\nEVs: 2 HP / 32 Atk / 32 Spe\nJolly Nature\n- Earthquake\n…'} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      {parsed && (
        <div className="mt-3 text-sm">
          <p className="text-muted">
            {parsed.builds.length} builds detectadas: {parsed.builds.map((b) => b.species).join(', ')}. Si ya tienes la especie, se añade como build nueva.
          </p>
          {parsed.warnings.map((w, i) => (
            <p key={i} className="text-warn">
              ⚠ {w}
            </p>
          ))}
        </div>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={!parsed?.builds.length} onClick={apply}>
          Importar {parsed?.builds.length ?? 0}
        </button>
      </div>
    </Modal>
  );
}

function EditModal({ value, onClose, onSave, onDelete, deleteLabel }: { value: OwnedPokemon; onClose: () => void; onSave: (p: OwnedPokemon) => void; onDelete?: () => void; deleteLabel?: string }) {
  const { t, names, pokemon, settings } = useApp();
  const ownAll = settings.ownAll;
  const [p, setP] = useState(value);
  const [active, setActive] = useState(p.builds[0]?.id);
  const isNew = !pokemon.some((x) => x.id === p.id);
  const b = p.builds.find((x) => x.id === active);
  const setBuild = (patch: Partial<OwnedBuild>) => setP({ ...p, builds: p.builds.map((x) => (x.id === active ? { ...x, ...patch } : x)) });

  return (
    <Modal title={`${names.species(p.species)}${isNew ? ' · nuevo' : ''}`} onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className="label">Apodo</label>
          <input className="input" value={p.nickname} onChange={(e) => setP({ ...p, nickname: e.target.value })} />
        </div>
        {!ownAll && (<>
        <div>
          <label className="label">Disponibilidad</label>
          <select className="input" value={p.status} onChange={(e) => setP({ ...p, status: e.target.value as PokemonStatus })}>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Coste de modificación (VP)</label>
          <input className="input num" type="number" min={0} value={p.modificationCost ?? ''} onChange={(e) => setP({ ...p, modificationCost: e.target.value === '' ? null : Number(e.target.value) })} />
        </div>
        <div className="flex items-end gap-4 pb-1.5 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={p.favorite} onChange={(e) => setP({ ...p, favorite: e.target.checked })} /> Favorito
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={p.trainable} onChange={(e) => setP({ ...p, trainable: e.target.checked })} /> Entrenable
          </label>
        </div>
        </>)}
        {ownAll && (
          <label className="flex items-end gap-1.5 pb-1.5 text-sm">
            <input type="checkbox" checked={p.favorite} onChange={(e) => setP({ ...p, favorite: e.target.checked })} /> ★ Favorito (el Squad Builder siempre lo tiene en cuenta)
          </label>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-line pb-3">
        {p.builds.map((x) => (
          <button key={x.id} onClick={() => setActive(x.id)} className={`rounded-md px-3 py-1 text-sm ${x.id === active ? 'bg-accent/15 font-semibold text-text' : 'text-muted hover:bg-panel-2'}`}>
            {x.name}
          </button>
        ))}
        <button
          className="btn btn-ghost"
          onClick={() => {
            const nb: OwnedBuild = b ? { ...structuredClone(b), id: uid(), name: `${b.name} (copia)` } : { id: uid(), name: `Build ${p.builds.length + 1}`, role: '', build: defaultBuild(p.species), notes: '' };
            setP({ ...p, builds: [...p.builds, nb] });
            setActive(nb.id);
          }}
        >
          <Plus size={14} /> {b ? 'Duplicar build' : 'Nueva build'}
        </button>
      </div>

      {b ? (
        <>
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Nombre de la build</label>
              <input className="input" value={b.name} onChange={(e) => setBuild({ name: e.target.value })} />
            </div>
            <div>
              <label className="label">Rol competitivo</label>
              <input className="input" placeholder="p. ej. atacante físico, soporte TR" value={b.role} onChange={(e) => setBuild({ role: e.target.value })} />
            </div>
            <div className="flex items-end justify-end">
              <button
                className="btn text-bad"
                disabled={p.builds.length <= 1}
                title={p.builds.length <= 1 ? 'Debe quedar al menos una build' : undefined}
                onClick={() => {
                  const rest = p.builds.filter((x) => x.id !== active);
                  setP({ ...p, builds: rest });
                  setActive(rest[0]?.id);
                }}
              >
                <Trash2 size={14} /> Eliminar build
              </button>
            </div>
          </div>
          <BuildEditor build={b.build} onChange={(build) => setBuild({ build })} />
        </>
      ) : (
        <Empty>Sin builds.</Empty>
      )}

      <div className="mt-4">
        <label className="label">Notas</label>
        <textarea className="input h-16" value={p.notes} onChange={(e) => setP({ ...p, notes: e.target.value })} />
      </div>
      <div className="mt-4 flex justify-between">
        {!isNew && onDelete ? (
          <button className="btn text-bad" onClick={onDelete}>
            <Trash2 size={14} /> {deleteLabel ?? 'Eliminar Pokémon'}
          </button>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <button className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="btn btn-primary" onClick={() => onSave(p)}>
            {t('common.save')}
          </button>
        </div>
      </div>
    </Modal>
  );
}
