import { useEffect, useState, type ComponentType } from 'react';
import { Activity, BookOpen, FlaskConical, Calculator, Gauge, History, LayoutDashboard, MessageSquare, Settings as SettingsIcon, Sparkles, Swords, Users, Wrench, Boxes, Moon, Sun } from 'lucide-react';
import { useApp } from './lib/app';
import type { UIKey } from './lib/i18n';
import type { Mode } from './lib/types';
import { MasterBall, MASTER_BALL_FAVICON } from './components/MasterBall';
import { Segmented, Sprite } from './components/ui';
import { resolveTeam } from './lib/pokemon';
import Dashboard from './pages/Dashboard';
import BattleAdvisor from './pages/BattleAdvisor';
import MyPokemon from './pages/MyPokemon';
import Teams from './pages/Teams';
import DamageCalc from './pages/DamageCalc';
import SpeedTiers from './pages/SpeedTiers';
import BattleHistory from './pages/BattleHistory';
import SettingsPage from './pages/Settings';
import MetaIntelligence from './pages/MetaIntelligence';
import BuildOptimizer from './pages/BuildOptimizer';
import SquadBuilder from './pages/SquadBuilder';
import Recruitment from './pages/Recruitment';
import Simulator from './pages/Simulator';
import Coach from './pages/Coach';

interface Route {
  id: string;
  key: UIKey;
  icon: ComponentType<{ size?: number; className?: string }>;
  page: ComponentType;
  hint: string; // one line: what you do here
}

interface Group {
  title: string;
  routes: Route[];
}

/** Grouped by what the user wants to do, in the order they usually do it. */
export const GROUPS: Group[] = [
  {
    title: 'Inicio',
    routes: [{ id: 'dashboard', key: 'nav.dashboard', icon: LayoutDashboard, page: Dashboard, hint: 'Resumen y primeros pasos' }],
  },
  {
    title: 'Jugar',
    routes: [
      { id: 'advisor', key: 'nav.advisor', icon: Swords, page: BattleAdvisor, hint: 'Qué sacar contra este rival' },
      { id: 'history', key: 'nav.history', icon: History, page: BattleHistory, hint: 'Apunta tus combates' },
    ],
  },
  {
    title: 'Mi colección',
    routes: [
      { id: 'pokemon', key: 'nav.mypokemon', icon: Boxes, page: MyPokemon, hint: 'Tus Pokémon y sus builds' },
      { id: 'teams', key: 'nav.teams', icon: Users, page: Teams, hint: 'Equipos de 6 para buscar partida' },
    ],
  },
  {
    title: 'Mejorar',
    routes: [
      { id: 'coach', key: 'nav.coach', icon: MessageSquare, page: Coach, hint: 'Análisis y chat con IA' },
      { id: 'squad', key: 'nav.squad', icon: Sparkles, page: SquadBuilder, hint: 'Arma equipos automáticamente' },
      { id: 'optimizer', key: 'nav.optimizer', icon: Wrench, page: BuildOptimizer, hint: 'Mejora una build' },
      { id: 'recruit', key: 'nav.recruit', icon: BookOpen, page: Recruitment, hint: 'Qué Pokémon reclutar' },
    ],
  },
  {
    title: 'Herramientas',
    routes: [
      { id: 'calc', key: 'nav.calc', icon: Calculator, page: DamageCalc, hint: 'Daño y umbrales de SP' },
      { id: 'speed', key: 'nav.speed', icon: Gauge, page: SpeedTiers, hint: 'Quién es más rápido' },
      { id: 'simulator', key: 'nav.simulator', icon: FlaskConical, page: Simulator, hint: 'Analiza un turno concreto' },
      { id: 'meta', key: 'nav.meta', icon: Activity, page: MetaIntelligence, hint: 'Lo que se usa ahora' },
    ],
  },
];
const SETTINGS: Route = { id: 'settings', key: 'nav.settings', icon: SettingsIcon, page: SettingsPage, hint: 'Idioma, tema, copias' };
export const ROUTES: Route[] = [...GROUPS.flatMap((g) => g.routes), SETTINGS];

export function navigate(id: string, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  window.location.hash = `#/${id}${q}`;
}

function useRoute() {
  const parse = () => window.location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard';
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

function useFavicon() {
  useEffect(() => {
    let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    link.href = MASTER_BALL_FAVICON;
  }, []);
}

function NavItem({ r, active }: { r: Route; active: boolean }) {
  const { t } = useApp();
  const Icon = r.icon;
  return (
    <a
      href={`#/${r.id}`}
      className={`group flex items-center gap-3 rounded-lg px-3 py-1.5 transition-colors ${active ? 'bg-accent/15 text-text shadow-[inset_3px_0_0_var(--accent)]' : 'text-muted hover:bg-panel-2 hover:text-text'}`}
    >
      <Icon size={17} className={active ? 'text-accent' : ''} />
      <span className="min-w-0">
        <span className={`block text-sm leading-tight ${active ? 'font-semibold' : ''}`}>{t(r.key)}</span>
        <span className="block truncate text-[11px] leading-tight text-faint">{r.hint}</span>
      </span>
    </a>
  );
}

/** Global context bar: the mode and active team every page uses. */
function TopBar({ current }: { current: Route }) {
  const { settings, saveSettings, teams, pokemon, regulation } = useApp();
  const mode = settings.defaultMode;
  const modeTeams = teams.filter((x) => x.format === mode);
  const active = teams.find((x) => x.id === settings.activeTeam[mode]);
  const { builds } = resolveTeam(active, pokemon);
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-3 border-b border-line bg-bg/85 px-8 py-2.5 backdrop-blur">
      <span className="text-sm text-faint">
        {GROUPS.find((g) => g.routes.includes(current))?.title ?? 'Ajustes'} <span className="mx-1">/</span>
        <span className="text-text">{current.hint}</span>
      </span>
      <div className="ml-auto flex items-center gap-3">
        <Segmented<Mode> value={mode} onChange={(m) => saveSettings({ defaultMode: m })} options={[{ value: 'doubles', label: 'Dobles' }, { value: 'singles', label: 'Individuales' }]} />
        <div className="flex items-center gap-2">
          <span className="text-xs text-faint">Equipo</span>
          <select
            className="input w-44 py-1"
            value={active?.id ?? ''}
            onChange={(e) => (e.target.value === '__new' ? navigate('teams') : saveSettings({ activeTeam: { ...settings.activeTeam, [mode]: e.target.value } }))}
          >
            {!active && <option value="">— ninguno —</option>}
            {modeTeams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
            <option value="__new">+ Crear equipo…</option>
          </select>
          <span className="hidden gap-0.5 lg:flex">
            {builds.map((b, i) => (
              <Sprite key={i} species={b.species} size={26} kind="icon" />
            ))}
          </span>
        </div>
        <span className="chip" title={`Regulación activa: ${regulation.pack.validFrom.value} → ${regulation.pack.validTo.value}`}>
          Reg. {regulation.id}
        </span>
        <button className="btn btn-ghost p-1.5" title="Cambiar tema" onClick={() => saveSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}>
          {settings.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { ready, error, t, settings } = useApp();
  const route = useRoute();
  useFavicon();
  const current = ROUTES.find((r) => r.id === route) ?? ROUTES[0]!;
  const Page = current.page;

  if (error)
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="panel max-w-md p-6 text-sm">
          <MasterBall size={48} className="mb-3" />
          <p className="mb-2 font-semibold text-bad">Servidor no disponible</p>
          <p className="text-muted">{error}</p>
          <p className="mt-3 text-muted">Ábrelo con «Iniciar Champions Hub» del Escritorio.</p>
        </div>
      </div>
    );
  if (!ready)
    return (
      <div className="grid h-full place-items-center text-muted">
        <div className="flex flex-col items-center gap-3">
          <MasterBall size={56} className="animate-spin [animation-duration:1.6s]" />
          {t('common.loading')}
        </div>
      </div>
    );

  return (
    <div className="grid h-full grid-cols-[248px_1fr]">
      <aside className="flex flex-col border-r border-line bg-panel/60">
        <a href="#/dashboard" className="flex items-center gap-3 px-4 pt-4 pb-3">
          <MasterBall size={40} />
          <div>
            <div className="font-display text-xl leading-none font-bold tracking-wide">
              CHAMPIONS<span className="text-accent">HUB</span>
            </div>
            <div className="mt-0.5 text-[11px] text-faint">Tu asistente competitivo</div>
          </div>
        </a>
        <nav className="flex-1 overflow-auto px-2 pb-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="mt-3 first:mt-1">
              <div className="mb-1 px-3 text-[10px] font-bold tracking-[0.16em] text-faint uppercase">{g.title}</div>
              <div className="space-y-0.5">
                {g.routes.map((r) => (
                  <NavItem key={r.id} r={r} active={r.id === current.id} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-line p-2">
          <NavItem r={SETTINGS} active={current.id === 'settings'} />
          <p className="px-3 pt-2 text-[10px] leading-snug text-faint">
            Herramienta gratuita y no oficial, hecha por fans. Sin afiliación con Nintendo, Game Freak ni The Pokémon Company. Estadísticas de uso: Smogon / Pokémon Showdown.{' '}
            <a className="underline" href="https://github.com/omstriondsux/pokemon-champions-hub" target="_blank" rel="noreferrer">
              Código abierto
            </a>
          </p>
        </div>
      </aside>
      <main className="overflow-auto">
        <TopBar current={current} />
        {/* Pages read the global mode on mount; keying by mode re-mounts them when it changes. */}
        <div className="mx-auto max-w-[1400px] px-8 py-6">{<Page key={`${current.id}-${settings.defaultMode}`} />}</div>
      </main>
    </div>
  );
}
