import { useEffect, useState, type ComponentType } from 'react';
import { Activity, BookOpen, Calculator, Gauge, History, LayoutDashboard, Lock, MessageSquare, Settings as SettingsIcon, Sparkles, Swords, Users, Wrench, Boxes } from 'lucide-react';
import { useApp } from './lib/app';
import type { UIKey } from './lib/i18n';
import Dashboard from './pages/Dashboard';
import BattleAdvisor from './pages/BattleAdvisor';
import MyPokemon from './pages/MyPokemon';
import Teams from './pages/Teams';
import DamageCalc from './pages/DamageCalc';
import SpeedTiers from './pages/SpeedTiers';
import BattleHistory from './pages/BattleHistory';
import SettingsPage from './pages/Settings';

interface Route {
  id: string;
  key: UIKey;
  icon: ComponentType<{ size?: number }>;
  page?: ComponentType;
  phase?: string;
}

export const ROUTES: Route[] = [
  { id: 'dashboard', key: 'nav.dashboard', icon: LayoutDashboard, page: Dashboard },
  { id: 'advisor', key: 'nav.advisor', icon: Swords, page: BattleAdvisor },
  { id: 'pokemon', key: 'nav.mypokemon', icon: Boxes, page: MyPokemon },
  { id: 'teams', key: 'nav.teams', icon: Users, page: Teams },
  { id: 'calc', key: 'nav.calc', icon: Calculator, page: DamageCalc },
  { id: 'speed', key: 'nav.speed', icon: Gauge, page: SpeedTiers },
  { id: 'history', key: 'nav.history', icon: History, page: BattleHistory },
  { id: 'meta', key: 'nav.meta', icon: Activity, phase: 'F2' },
  { id: 'optimizer', key: 'nav.optimizer', icon: Wrench, phase: 'F2' },
  { id: 'squad', key: 'nav.squad', icon: Sparkles, phase: 'F2' },
  { id: 'recruit', key: 'nav.recruit', icon: BookOpen, phase: 'F3' },
  { id: 'coach', key: 'nav.coach', icon: MessageSquare, phase: 'F4' },
  { id: 'settings', key: 'nav.settings', icon: SettingsIcon, page: SettingsPage },
];

export function navigate(id: string, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params)}` : '';
  window.location.hash = `#/${id}${q}`;
}

function useRoute() {
  const parse = () => (window.location.hash.replace(/^#\//, '').split('?')[0] || 'dashboard');
  const [r, setR] = useState(parse);
  useEffect(() => {
    const f = () => setR(parse());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

export default function App() {
  const { ready, error, t, regulation } = useApp();
  const route = useRoute();
  const current = ROUTES.find((r) => r.id === route) ?? ROUTES[0]!;
  const Page = current.page;

  if (error)
    return (
      <div className="grid h-full place-items-center p-6">
        <div className="panel max-w-md p-6 text-sm">
          <p className="mb-2 font-semibold text-bad">Servidor no disponible</p>
          <p className="text-muted">{error}</p>
          <p className="mt-3 text-muted">
            Arráncalo con <code className="num text-text">npm run dev</code> en la carpeta del proyecto.
          </p>
        </div>
      </div>
    );
  if (!ready) return <div className="grid h-full place-items-center text-muted">{t('common.loading')}</div>;

  return (
    <div className="grid h-full grid-cols-[232px_1fr]">
      <aside className="flex flex-col border-r border-line bg-panel/60">
        <div className="px-5 pt-5 pb-4">
          <div className="font-display text-xl leading-none font-bold tracking-wide">
            CHAMPIONS<span className="text-accent">HUB</span>
          </div>
          <div className="mt-1 text-[11px] text-faint">Competitive Intelligence · {regulation.id}</div>
        </div>
        <nav className="flex-1 space-y-0.5 overflow-auto px-2">
          {ROUTES.map((r) => {
            const Icon = r.icon;
            const active = r.id === current.id;
            const disabled = !r.page;
            return (
              <a
                key={r.id}
                href={disabled ? undefined : `#/${r.id}`}
                title={disabled ? `${t('nav.soon')} · ${r.phase}` : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors ${active ? 'bg-accent/15 font-semibold text-text shadow-[inset_2px_0_0_var(--accent)]' : disabled ? 'cursor-default text-faint' : 'text-muted hover:bg-panel-2 hover:text-text'}`}
              >
                <Icon size={16} />
                <span className="flex-1">{t(r.key)}</span>
                {disabled && (
                  <span className="flex items-center gap-0.5 text-[10px]">
                    <Lock size={10} />
                    {r.phase}
                  </span>
                )}
              </a>
            );
          })}
        </nav>
        <p className="px-5 py-4 text-[10px] leading-snug text-faint">Herramienta personal no oficial. Sin afiliación con Nintendo, Game Freak ni The Pokémon Company.</p>
      </aside>
      <main className="overflow-auto">
        <div className="mx-auto max-w-[1400px] px-8 py-7">{Page ? <Page key={current.id} /> : null}</div>
      </main>
    </div>
  );
}
