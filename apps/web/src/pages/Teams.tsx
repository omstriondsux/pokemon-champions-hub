import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, Plus, Star, Trash2, X } from 'lucide-react';
import { exportPaste, validateTeam, type TeamIssue } from '@pch/engine';
import { useApp } from '../lib/app';
import { resolveTeam } from '../lib/pokemon';
import { uid, type Mode, type Team } from '../lib/types';
import { Empty, ItemIcon, Modal, PageHeader, Segmented, Sprite } from '../components/ui';

export function useTeamIssues(team: Team | undefined) {
  const { pokemon, regulation } = useApp();
  const [issues, setIssues] = useState<TeamIssue[]>([]);
  useEffect(() => {
    let live = true;
    if (!team) return setIssues([]);
    const { builds } = resolveTeam(team, pokemon);
    validateTeam(builds, regulation, team.format).then((i) => live && setIssues(i));
    return () => {
      live = false;
    };
  }, [team, pokemon, regulation]);
  return issues;
}

export default function Teams() {
  const { teams, t, settings, saveSettings, remove } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const [editing, setEditing] = useState<Team>();
  const list = teams.filter((x) => x.format === mode);

  return (
    <div className="fade-up">
      <PageHeader
        title={t('nav.teams')}
        subtitle="El equipo registrado es el que llevas a buscar partida. El Battle Advisor solo elige entre sus miembros."
        actions={
          <>
            <button className="btn btn-primary" onClick={() => setEditing({ id: uid(), name: `Equipo ${list.length + 1}`, format: mode, regulation: '', members: [], notes: '' })}>
              <Plus size={15} /> Nuevo equipo
            </button>
          </>
        }
      />
      {list.length === 0 ? (
        <Empty>No hay equipos de {t(`mode.${mode}`).toLowerCase()}. Crea uno a partir de las builds de tu inventario.</Empty>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((team) => (
            <TeamCard key={team.id} team={team} active={settings.activeTeam[mode] === team.id} onActivate={() => saveSettings({ activeTeam: { ...settings.activeTeam, [mode]: team.id } })} onEdit={() => setEditing(structuredClone(team))} onDelete={() => confirm(`¿Eliminar "${team.name}"?`) && remove('teams', team.id)} />
          ))}
        </div>
      )}
      {editing && <TeamEditor value={editing} onClose={() => setEditing(undefined)} />}
    </div>
  );
}

function TeamCard({ team, active, onActivate, onEdit, onDelete }: { team: Team; active: boolean; onActivate: () => void; onEdit: () => void; onDelete: () => void }) {
  const { pokemon, names } = useApp();
  const issues = useTeamIssues(team);
  const errors = issues.filter((i) => i.severity === 'error');
  const { builds, missing } = resolveTeam(team, pokemon);
  return (
    <div className={`panel p-4 ${active ? 'border-accent/60 shadow-[0_0_0_1px_var(--accent)]' : ''}`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="font-display text-lg font-bold">{team.name}</div>
          <div className="text-xs text-muted">
            {builds.length} miembros · {team.regulation || '—'} {active && <span className="text-accent">· equipo activo</span>}
          </div>
        </div>
        <div className="flex gap-1">
          <button className="btn btn-ghost p-1.5" title="Usar como equipo activo" onClick={onActivate}>
            <Star size={15} className={active ? 'text-warn' : ''} fill={active ? 'currentColor' : 'none'} />
          </button>
          <button className="btn btn-ghost p-1.5" title="Copiar en formato Showdown" onClick={() => navigator.clipboard.writeText(exportPaste(builds))}>
            <Copy size={15} />
          </button>
          <button className="btn" onClick={onEdit}>
            Editar
          </button>
          <button className="btn btn-ghost p-1.5 text-bad" onClick={onDelete}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {builds.map((b, i) => (
          <div key={i} className="flex w-[30%] min-w-28 items-center gap-1.5 rounded-lg bg-panel-2 p-1.5 text-xs">
            <Sprite species={b.species} size={36} />
            <div className="min-w-0">
              <div className="truncate font-medium">{names.species(b.species)}</div>
              <div className="flex items-center gap-1 truncate text-faint">
                <ItemIcon item={b.item} /> {names.item(b.item) || '—'}
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-xs">
        {missing > 0 && <p className="text-bad">⚠ {missing} build(s) ya no existen en el inventario.</p>}
        {errors.length === 0 && missing === 0 ? (
          <p className="flex items-center gap-1 text-good">
            <CheckCircle2 size={13} /> Equipo legal
          </p>
        ) : (
          errors.slice(0, 4).map((e, i) => (
            <p key={i} className="text-bad">
              ⚠ {e.message}
            </p>
          ))
        )}
      </div>
    </div>
  );
}

function TeamEditor({ value, onClose }: { value: Team; onClose: () => void }) {
  const { pokemon, names, regulation, save, teams } = useApp();
  const [team, setTeam] = useState<Team>({ ...value, regulation: value.regulation || regulation.id });
  const issues = useTeamIssues(team);
  const max = regulation.format(team.format).teamSize.value.max;
  const [q, setQ] = useState('');
  const options = useMemo(() => {
    const tag = team.format === 'singles' ? '-s' : '-d';
    const id = q.toLowerCase();
    return pokemon
      .filter((p) => p.status !== 'unavailable')
      .filter((p) => !id || `${p.species} ${names.species(p.species)}`.toLowerCase().includes(id))
      // untouched catalog entries: only builds for this format (meta "dobles"/"individuales")
      .flatMap((p) => (p.source === 'catalog' ? p.builds.filter((b) => b.id.includes(tag) || b.id.includes('-h')) : p.builds).map((b) => ({ p, b })))
      .slice(0, 120);
  }, [pokemon, q, names, team.format]);
  const inTeam = (pid: string, bid: string) => team.members.some((m) => m.pokemonId === pid && m.buildId === bid);
  const isNew = !teams.some((x) => x.id === team.id);

  return (
    <Modal title={isNew ? 'Nuevo equipo' : `Editar ${team.name}`} onClose={onClose} wide>
      <div className="mb-4 grid grid-cols-2 gap-3">
        <div>
          <label className="label">Nombre</label>
          <input className="input" value={team.name} onChange={(e) => setTeam({ ...team, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Formato</label>
          <select className="input" value={team.format} onChange={(e) => setTeam({ ...team, format: e.target.value as Mode })}>
            <option value="doubles">Dobles</option>
            <option value="singles">Individuales</option>
          </select>
        </div>
      </div>
      <div className="panel-title mb-2">
        Miembros ({team.members.length}/{max})
      </div>
      <div className="mb-4 flex min-h-16 flex-wrap gap-2 rounded-lg border border-dashed border-line-strong p-2">
        {team.members.map((m, i) => {
          const p = pokemon.find((x) => x.id === m.pokemonId);
          const b = p?.builds.find((x) => x.id === m.buildId);
          return (
            <div key={i} className="flex items-center gap-1.5 rounded-lg bg-panel-2 py-1 pr-1 pl-2 text-xs">
              <Sprite species={p?.species ?? ''} size={28} kind="icon" />
              {p ? names.species(p.species) : '¿?'} · {b?.name ?? 'build borrada'}
              <button className="rounded p-0.5 text-faint hover:text-bad" onClick={() => setTeam({ ...team, members: team.members.filter((_, k) => k !== i) })}>
                <X size={13} />
              </button>
            </div>
          );
        })}
        {team.members.length === 0 && <span className="p-2 text-xs text-faint">Elige builds de la lista de abajo.</span>}
      </div>
      <input className="input mb-2" placeholder="Busca un Pokémon para añadirlo (ES o EN)…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {options.length === 0 ? (
        <Empty>{q ? 'Ningún Pokémon coincide.' : 'Primero añade Pokémon y builds en «Mis Pokémon».'}</Empty>
      ) : (
        <div className="grid max-h-72 grid-cols-2 gap-1.5 overflow-auto md:grid-cols-3">
          {options.map(({ p, b }) => {
            const on = inTeam(p.id, b.id);
            return (
              <button
                key={b.id}
                disabled={!on && team.members.length >= max}
                onClick={() => setTeam({ ...team, members: on ? team.members.filter((m) => !(m.pokemonId === p.id && m.buildId === b.id)) : [...team.members, { pokemonId: p.id, buildId: b.id }] })}
                className={`flex items-center gap-2 rounded-lg border p-1.5 text-left text-xs transition-colors disabled:opacity-40 ${on ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'}`}
              >
                <Sprite species={p.species} size={32} kind="icon" />
                <div className="min-w-0">
                  <div className="truncate font-medium">{names.species(p.species)}</div>
                  <div className="truncate text-faint">
                    {b.name} · {names.item(b.build.item) || 'sin objeto'}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
      <ul className="mt-3 space-y-0.5 text-xs">
        {issues
          .filter((i) => i.severity === 'error' || i.code === 'multiple-megas')
          .map((i, k) => (
            <li key={k} className={i.severity === 'error' ? 'text-bad' : 'text-warn'}>
              ⚠ {i.message}
              {i.ruleConfidence && i.ruleConfidence !== 'verified' ? ` (regla ${i.ruleConfidence})` : ''}
            </li>
          ))}
      </ul>
      <div className="mt-4 flex justify-end gap-2">
        <button className="btn" onClick={onClose}>
          Cancelar
        </button>
        <button
          className="btn btn-primary"
          onClick={async () => {
            await save('teams', team);
            onClose();
          }}
        >
          Guardar
        </button>
      </div>
    </Modal>
  );
}
