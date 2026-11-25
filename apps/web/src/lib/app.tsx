import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { activeRegulation, Regulation, type MetaSnapshot } from '@pch/engine';
import { api } from './api';
import { makeNames, makeT, type NameTable, type Names } from './i18n';
import { DEFAULT_SETTINGS, type BattleRecord, type Mode, type OwnedPokemon, type Settings, type Team } from './types';

interface MetaIndexEntry {
  file: string;
  mode: string;
  ratingCutoff: number;
  month: string;
  battles: number;
  regulation: string;
}

interface AppState {
  ready: boolean;
  error?: string;
  settings: Settings;
  saveSettings: (s: Partial<Settings>) => Promise<void>;
  t: ReturnType<typeof makeT>;
  names: Names;
  regulations: Regulation[];
  regulation: Regulation; // active today (or most recent)
  metaIndex: MetaIndexEntry[];
  /** Usage snapshot for a mode at the configured rating cutoff (latest month). */
  snapshot: (mode: Mode) => Promise<MetaSnapshot | undefined>;
  pokemon: OwnedPokemon[];
  teams: Team[];
  battles: BattleRecord[];
  reload: () => Promise<void>;
  save: <T extends { id: string }>(c: 'pokemon' | 'teams' | 'battles', doc: T) => Promise<T>;
  remove: (c: 'pokemon' | 'teams' | 'battles', id: string) => Promise<void>;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('useApp outside provider');
  return c;
};

const today = () => new Date().toISOString().slice(0, 10);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [es, setEs] = useState<NameTable>({});
  const [regulations, setRegulations] = useState<Regulation[]>([]);
  const [metaIndex, setMetaIndex] = useState<MetaIndexEntry[]>([]);
  const [pokemon, setPokemon] = useState<OwnedPokemon[]>([]);
  const [teams, setTeams] = useState<Team[]>([]);
  const [battles, setBattles] = useState<BattleRecord[]>([]);
  const snapCache = useRef(new Map<string, Promise<MetaSnapshot | undefined>>());

  const reload = useCallback(async () => {
    const [p, t, b] = await Promise.all([api.list<OwnedPokemon>('pokemon'), api.list<Team>('teams'), api.list<BattleRecord>('battles')]);
    setPokemon(p);
    setTeams(t);
    setBattles(b);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [s, regs, idx, i18n] = await Promise.all([api.settings(), api.regulations(), api.metaIndex(), api.i18n('es')]);
        setSettings({ ...DEFAULT_SETTINGS, ...(s as Partial<Settings>) });
        setRegulations(regs.map((r) => new Regulation(r)));
        setMetaIndex(idx.snapshots);
        setEs(i18n as NameTable);
        await reload();
        setReady(true);
      } catch (e) {
        setError(`No se pudo conectar con el servidor local: ${String(e)}`);
      }
    })();
  }, [reload]);

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme;
    document.documentElement.lang = settings.lang;
  }, [settings.theme, settings.lang]);

  const saveSettings = useCallback(async (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    await api.putSettings(patch);
  }, []);

  const regulation = useMemo(() => {
    if (!regulations.length) return undefined as unknown as Regulation;
    return activeRegulation(regulations, today()) ?? [...regulations].sort((a, b) => b.pack.validFrom.value.localeCompare(a.pack.validFrom.value))[0]!;
  }, [regulations]);

  const snapshot = useCallback(
    (mode: Mode) => {
      const entries = metaIndex.filter((e) => e.mode === mode).sort((a, b) => b.month.localeCompare(a.month) || Math.abs(a.ratingCutoff - settings.ratingCutoff) - Math.abs(b.ratingCutoff - settings.ratingCutoff));
      const e = entries[0];
      if (!e) return Promise.resolve(undefined);
      if (!snapCache.current.has(e.file)) snapCache.current.set(e.file, api.snapshot<MetaSnapshot>(e.file).catch(() => undefined));
      return snapCache.current.get(e.file)!;
    },
    [metaIndex, settings.ratingCutoff],
  );

  const save = useCallback(
    async <T extends { id: string }>(c: 'pokemon' | 'teams' | 'battles', doc: T) => {
      const saved = await api.put(c, doc);
      await reload();
      return saved;
    },
    [reload],
  );
  const remove = useCallback(
    async (c: 'pokemon' | 'teams' | 'battles', id: string) => {
      await api.del(c, id);
      await reload();
    },
    [reload],
  );

  const value: AppState = {
    ready: ready && !!regulation,
    error,
    settings,
    saveSettings,
    t: makeT(settings.lang),
    names: makeNames(settings.lang, es),
    regulations,
    regulation,
    metaIndex,
    snapshot,
    pokemon,
    teams,
    battles,
    reload,
    save,
    remove,
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
