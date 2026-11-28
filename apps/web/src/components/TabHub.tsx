import { useEffect, useState, type ComponentType } from 'react';

export interface HubTab {
  id: string;
  label: string;
  hint: string;
  page: ComponentType;
}

const tabFromHash = () => new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('tab') ?? undefined;

/**
 * One menu entry, several related screens as tabs (e.g. "Mis equipos" = teams, auto-build, build optimizer…).
 * The tab lives in the URL (#/teams?tab=auto) so links and the back button keep working.
 */
export function TabHub({ base, tabs }: { base: string; tabs: HubTab[] }) {
  const [tab, setTab] = useState(() => tabFromHash() ?? tabs[0]!.id);
  useEffect(() => {
    const f = () => setTab(tabFromHash() ?? tabs[0]!.id);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, [tabs]);
  const current = tabs.find((t) => t.id === tab) ?? tabs[0]!;
  const Page = current.page;
  const go = (id: string) => {
    window.location.hash = `#/${base}?tab=${id}`;
  };
  return (
    <div>
      <div className="-mx-3 mb-4 overflow-x-auto border-b border-line px-3 sm:-mx-8 sm:px-8">
        <div className="flex min-w-max gap-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={t.id === current.id}
              title={t.hint}
              onClick={() => go(t.id)}
              className={`relative px-3 py-2.5 text-sm whitespace-nowrap transition-colors ${t.id === current.id ? 'font-semibold text-text' : 'text-muted hover:text-text'}`}
            >
              {t.label}
              {t.id === current.id && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-accent" />}
            </button>
          ))}
        </div>
      </div>
      <Page key={current.id} />
    </div>
  );
}
