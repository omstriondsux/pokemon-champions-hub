import { useEffect, useMemo, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { detectArchetypes, type MetaSnapshot, type SquadResult } from '@pch/engine';
import { useApp } from '../lib/app';
import { resolveTeam } from '../lib/pokemon';
import { runAnalysis } from '../lib/worker';
import type { Mode } from '../lib/types';
import { wilson } from './BattleHistory';
import { Empty, PageHeader, Segmented, Sprite } from '../components/ui';

interface ThreatRow {
  species: string;
  usage: number;
  scores: number[];
  best: number;
}

type Kind = 'hecho' | 'cálculo' | 'estadística' | 'inferencia' | 'hipótesis';
const KIND_STYLE: Record<Kind, string> = {
  hecho: 'border-good/40 text-good',
  cálculo: 'border-accent-2/40 text-accent-2',
  estadística: 'border-accent/40 text-accent',
  inferencia: 'border-warn/40 text-warn',
  hipótesis: 'border-bad/40 text-bad',
};

interface Insight {
  q: string;
  a: string;
  kind: Kind;
  evidence: string;
}

/**
 * Analytical coach (no generative AI, by the user's choice): answers the core questions with the
 * engine's numbers and labels each answer as fact / calculation / statistic / inference / hypothesis.
 */
export default function Coach() {
  const { settings, teams, pokemon, regulation, snapshot, battles, names } = useApp();
  const [mode, setMode] = useState<Mode>(settings.defaultMode);
  const team = teams.find((x) => x.id === settings.activeTeam[mode]);
  const { builds } = resolveTeam(team, pokemon);
  const [threats, setThreats] = useState<ThreatRow[]>();
  const [squad, setSquad] = useState<SquadResult>();
  const [snap, setSnap] = useState<MetaSnapshot>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!builds.length) return;
    let live = true;
    (async () => {
      setBusy(true);
      const s = await snapshot(mode);
      setSnap(s);
      const pool = builds.map((b, i) => ({ id: `m${i}`, ownerId: `m${i}`, label: b.species, build: b }));
      const [t, q] = await Promise.all([
        runAnalysis<{ result: { rows: ThreatRow[] } }>({ type: 'metaThreats', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, team: builds, format: mode, topN: 24 }),
        runAnalysis<{ result: SquadResult }>({ type: 'squad', pack: regulation.pack, snapshot: s, snapshotKey: s?.meta.url, pool, format: mode, profile: 'balanced', locked: pool.map((p) => p.id), topN: 24 }),
      ]);
      if (!live) return;
      setThreats(t.result.rows);
      setSquad(q.result);
      setBusy(false);
    })().catch(() => setBusy(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.id, team?.updatedAt, mode]);

  const insights = useMemo<Insight[]>(() => {
    if (!threats || !squad?.teams[0]) return [];
    const out: Insight[] = [];
    const t = squad.teams[0];
    const uncovered = threats.filter((r) => r.best < 0.25).sort((a, b) => b.usage - a.usage);
    out.push({
      q: '¿Cuál es la mayor debilidad de mi equipo?',
      a: uncovered.length ? `No tienes respuesta 1v1 clara para ${uncovered.slice(0, 4).map((u) => `${names.species(u.species)} (${(u.usage * 100).toFixed(0)}% de uso)`).join(', ')}.` : 'Tienes al menos una respuesta 1v1 para cada uno de los 24 más usados.',
      kind: 'cálculo',
      evidence: 'Índice 1v1 exacto contra las builds probables del top 24 (Smogon, simulador).',
    });
    const weakest = [...t.contributions].sort((a, b) => a.delta - b.delta)[0];
    if (weakest) {
      out.push({
        q: '¿Qué Pokémon debería reemplazar?',
        a: `${names.species(builds[weakest.member]!.species)}: es el que menos aporta (el equipo pierde ${weakest.delta.toFixed(3)} si se quita). Prueba el Squad Builder o el Recruitment Advisor para encontrar un sustituto que cubra ${uncovered[0] ? names.species(uncovered[0].species) : 'tus huecos'}.`,
        kind: 'cálculo',
        evidence: 'Contribución marginal en la puntuación de equipo (perfil equilibrado).',
      });
    }
    const totalC = t.contributions.reduce((s, c) => s + Math.max(0, c.delta), 0) || 1;
    const top = [...t.contributions].sort((a, b) => b.delta - a.delta)[0];
    if (top) {
      const share = Math.max(0, top.delta) / totalC;
      out.push({
        q: '¿Dependo demasiado de un Pokémon?',
        a: share > 0.4 ? `Sí: ${names.species(builds[top.member]!.species)} concentra el ${(share * 100).toFixed(0)}% del valor del equipo. Si cae pronto o el rival lo neutraliza, pierdes casi toda la cobertura.` : `No de forma grave: el miembro más importante (${names.species(builds[top.member]!.species)}) aporta el ${(share * 100).toFixed(0)}% del valor.`,
        kind: 'inferencia',
        evidence: 'Reparto de las contribuciones marginales entre los miembros.',
      });
    }
    const sc = t.terms.speed > 0;
    out.push({
      q: '¿Tengo control de velocidad?',
      a: sc ? 'Sí, al menos un miembro lleva Tailwind, Trick Room, Icy Wind, Electroweb o Thunder Wave.' : 'No. Ningún miembro controla la velocidad: frente a equipos rápidos o de Trick Room dependes solo de tus velocidades base.',
      kind: 'hecho',
      evidence: 'Movimientos registrados en tus builds.',
    });
    if (t.weaknesses.length) out.push({ q: '¿Debilidades compartidas?', a: `3 o más miembros son débiles a: ${t.weaknesses.join(', ')}. Un solo atacante de ese tipo presiona a medio equipo.`, kind: 'hecho', evidence: 'Tabla de tipos.' });

    // History: performance vs Trick Room teams
    const mine = battles.filter((b) => b.format === mode);
    const tr = mine.filter((b) => detectArchetypes(b.opponentTeam, snap).includes('trickroom'));
    if (tr.length) {
      const w = tr.filter((b) => b.result === 'win').length;
      const [lo, hi] = wilson(w, tr.length);
      out.push({
        q: '¿Por qué pierdo contra Trick Room?',
        a: tr.length < 5 ? `Solo hay ${tr.length} combates contra Trick Room (${w} victorias): muestra demasiado pequeña para sacar conclusiones.` : `Contra equipos de Trick Room ganas ${w}/${tr.length} (IC95% ${(lo * 100).toFixed(0)}–${(hi * 100).toFixed(0)}%). ${sc ? 'Revisa si tu control de velocidad llega a tiempo o si conviene Taunt/Imprison.' : 'No tienes respuesta a Trick Room en el equipo (Taunt, Imprison o TR propio).'}`,
        kind: tr.length < 5 ? 'hipótesis' : 'estadística',
        evidence: 'Tu historial; Trick Room detectado con las estadísticas de uso del rival.',
      });
    }
    const reasons = new Map<string, number>();
    for (const b of mine.filter((x) => x.result === 'loss')) for (const m of b.mistakes) reasons.set(m.toLowerCase(), (reasons.get(m.toLowerCase()) ?? 0) + 1);
    const rec = [...reasons.entries()].sort((a, b) => b[1] - a[1])[0];
    if (rec && rec[1] >= 2) out.push({ q: '¿Qué error repito?', a: `«${rec[0]}» aparece en ${rec[1]} derrotas.`, kind: 'estadística', evidence: 'Errores que registraste en el historial.' });
    return out;
  }, [threats, squad, builds, names, battles, mode, snap]);

  if (!team) return <Empty>Marca un equipo activo en «Equipos» para que el Coach analice tu equipo y tu historial.</Empty>;

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader
        title="Coach analítico"
        subtitle="Respuestas basadas en cálculos y en tu historial, sin IA generativa (decisión tuya). Cada respuesta indica si es un hecho, un cálculo, una estadística, una inferencia o una hipótesis."
      />
      <div className="mb-4 flex items-center gap-2">
        {builds.map((b, i) => (
          <Sprite key={i} species={b.species} size={40} />
        ))}
        <span className="ml-2 text-sm text-muted">{team.name}</span>
      </div>
      {busy && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <Loader2 size={15} className="animate-spin" /> Analizando tu equipo contra el meta…
        </div>
      )}
      <div className="space-y-3">
        {insights.map((i) => (
          <div key={i.q} className="panel p-4">
            <div className="mb-1 flex items-center gap-2">
              <Brain size={15} className="text-accent" />
              <span className="font-semibold">{i.q}</span>
              <span className={`chip ml-auto ${KIND_STYLE[i.kind]}`}>{i.kind}</span>
            </div>
            <p className="text-sm">{i.a}</p>
            <p className="mt-1 text-[11px] text-faint">Evidencia: {i.evidence}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
