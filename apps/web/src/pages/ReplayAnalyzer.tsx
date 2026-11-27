import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import type { ParsedBattle, Review, Side } from '@pch/engine/battle/log';
import { useApp } from '../lib/app';
import { runAnalysis } from '../lib/worker';
import { Empty, PageHeader, Segmented } from '../components/ui';
import { TurnReview } from '../components/TurnReview';

/** Public replays from replay.pokemonshowdown.com (the API allows browser requests from any site). */
const API = 'https://replay.pokemonshowdown.com';
const FORMATS = { doubles: 'gen9championsvgc2026regmc', singles: 'gen9championsbssregmc' } as const;
interface ReplayRow {
  id: string;
  uploadtime: number;
  players: string[];
  rating: number | null;
  format: string;
}
const STORE = 'pch.showdownUser';

export default function ReplayAnalyzer() {
  const { settings, regulation, snapshot } = useApp();
  const [mode, setMode] = useState<'doubles' | 'singles'>(settings.defaultMode);
  const [user, setUser] = useState(() => {
    try {
      return localStorage.getItem(STORE) ?? '';
    } catch {
      return '';
    }
  });
  const [link, setLink] = useState('');
  const [list, setList] = useState<ReplayRow[]>();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string>();
  const [res, setRes] = useState<{ id: string; parsed: ParsedBattle; review: Review; me: Side }>();

  const search = async () => {
    const u = user.trim();
    if (!u) return;
    setBusy(true);
    setErr(undefined);
    setList(undefined);
    try {
      localStorage.setItem(STORE, u);
    } catch {
      /* ignore */
    }
    try {
      const r = await fetch(`${API}/search.json?user=${encodeURIComponent(u)}&format=${FORMATS[mode]}`);
      if (!r.ok) throw new Error(`Showdown respondió ${r.status}`);
      const rows = (await r.json()) as ReplayRow[];
      setList(rows);
      if (!rows.length) setErr(`No hay replays públicos de «${u}» en ${mode === 'doubles' ? 'VGC Reg M-C' : 'BSS Reg M-C'}. En Showdown, al terminar una partida pulsa «Upload and share replay».`);
    } catch (e) {
      setErr(`No se pudo consultar Showdown: ${String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const open = async (id: string, me?: Side) => {
    setBusy(true);
    setErr(undefined);
    try {
      const r = await fetch(`${API}/${encodeURIComponent(id)}.json`);
      if (!r.ok) throw new Error(r.status === 404 ? 'Ese replay no existe o es privado.' : `Showdown respondió ${r.status}`);
      const d = (await r.json()) as { id: string; log: string; formatid: string };
      const m = d.formatid?.includes('bss') ? 'singles' : 'doubles';
      const s = await snapshot(m);
      const out = await runAnalysis<{ result: { parsed: ParsedBattle; review: Review } }>({ type: 'replay', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, log: d.log, me, player: user.trim() || undefined });
      setRes({ id: d.id, ...out.result, me: out.result.review.me });
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  };

  // replay link pasted: "https://replay.pokemonshowdown.com/gen9…-123" (optionally "-123pw" for private ones)
  const openLink = () => {
    const m = /(?:replay\.pokemonshowdown\.com\/)?([a-z0-9]+-\d+(?:-[a-z0-9]+pw)?)/i.exec(link.trim());
    if (m) open(m[1]!);
    else setErr('Pega un enlace de replay de Showdown, por ejemplo https://replay.pokemonshowdown.com/gen9championsvgc2026regmc-123456789');
  };

  useEffect(() => {
    if (user && !list) search();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  return (
    <div className="fade-up max-w-5xl">
      <PageHeader
        title="Analizar partidas"
        subtitle="Escribe tu nombre de Pokémon Showdown y elige una partida: te marco turno a turno dónde se te fue la ventaja y qué podías hacer mejor."
      />
      {!res && (
        <>
          <div className="panel mb-4 grid gap-4 p-4 md:grid-cols-2">
            <div>
              <div className="mb-1.5 text-sm font-semibold">Tu usuario de Showdown</div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
              >
                <input className="input" placeholder="p. ej. ash-ketchum" value={user} onChange={(e) => setUser(e.target.value)} />
                <button className="btn btn-primary" disabled={busy || !user.trim()}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />} Buscar
                </button>
              </form>
              <div className="mt-2">
                <Segmented value={mode} onChange={setMode} options={[{ value: 'doubles', label: 'Dobles (VGC)' }, { value: 'singles', label: 'Individuales (BSS)' }]} />
              </div>
            </div>
            <div>
              <div className="mb-1.5 text-sm font-semibold">…o pega el enlace de un replay</div>
              <form
                className="flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  openLink();
                }}
              >
                <input className="input" placeholder="https://replay.pokemonshowdown.com/…" value={link} onChange={(e) => setLink(e.target.value)} />
                <button className="btn" disabled={busy || !link.trim()}>
                  Analizar
                </button>
              </form>
              <p className="mt-2 text-[11px] text-faint">Solo partidas de Pokémon Showdown subidas como replay. Las del juego oficial no se pueden leer.</p>
            </div>
          </div>
          {err && <div className="mb-4 rounded-lg border border-warn/40 bg-warn/10 p-3 text-sm">{err}</div>}
          {list && list.length > 0 && (
            <div className="panel divide-y divide-line">
              {list.slice(0, 40).map((r) => {
                const meIdx = r.players.findIndex((p) => p.toLowerCase() === user.trim().toLowerCase());
                const rival = r.players[meIdx === 0 ? 1 : 0];
                return (
                  <button key={r.id} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm hover:bg-panel-2" onClick={() => open(r.id)} disabled={busy}>
                    <span className="num w-24 shrink-0 text-xs text-muted">{new Date(r.uploadtime * 1000).toLocaleDateString()}</span>
                    <span className="min-w-0 flex-1 truncate">
                      vs <b>{rival}</b>
                    </span>
                    {r.rating && <span className="num text-xs text-faint">{r.rating}</span>}
                    <span className="text-accent">Analizar →</span>
                  </button>
                );
              })}
            </div>
          )}
          {!list && !err && !busy && <Empty>Busca tu usuario para ver tus partidas de Reg M-C.</Empty>}
          {busy && (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Loader2 size={15} className="animate-spin" /> Cargando…
            </p>
          )}
        </>
      )}
      {res && (
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button className="btn" onClick={() => setRes(undefined)}>
              ← Otra partida
            </button>
            <Segmented
              value={res.me}
              onChange={(me) => open(res.id, me)}
              options={[
                { value: 'p1', label: `Ver como ${res.parsed.players.p1}` },
                { value: 'p2', label: `Ver como ${res.parsed.players.p2}` },
              ]}
            />
            <a className="btn btn-ghost ml-auto text-xs" href={`${API}/${res.id}`} target="_blank" rel="noreferrer">
              Ver en Showdown <ExternalLink size={13} />
            </a>
          </div>
          <TurnReview parsed={res.parsed} review={res.review} />
          <p className="mt-4 text-[11px] text-faint">
            Los KOs posibles se calculan con el motor de daño usando los movimientos que se vieron en la partida y las builds más comunes del meta (los replays no muestran los Stat Points). Revísalos con criterio.
          </p>
        </div>
      )}
    </div>
  );
}
