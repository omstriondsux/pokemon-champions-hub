import { useEffect, useRef, useState } from 'react';
import { Bot, KeyRound, Loader2, Send, Trash2, User } from 'lucide-react';
import { useApp } from '../lib/app';

interface Msg {
  role: 'user' | 'assistant';
  content: string;
  usage?: { input: number; cached: number; output: number; model: string };
  error?: boolean;
}

// Claude Sonnet 5.5, USD per million tokens (input / cache read / output)
const PRICE = { input: 2, cached: 0.1, output: 10 };
const costOf = (u: NonNullable<Msg['usage']>) => (u.input * PRICE.input + u.cached * PRICE.cached + u.output * PRICE.output) / 1e6;

const SUGGESTIONS = [
  '¿Cuál es la mayor debilidad de mi equipo?',
  '¿Qué Pokémon debería reemplazar y por cuál?',
  '¿Qué amenazas del meta estoy subestimando?',
  '¿Por qué pierdo contra Trick Room?',
  '¿Mi estrategia depende demasiado de un Pokémon?',
  '¿Qué objeto le pondrías a cada miembro?',
];
const STORE_KEY = 'pch.coachChat';

/** Lightweight formatting: **bold**, `[etiquetas]`, bullet lines. */
function Rich({ text }: { text: string }) {
  return (
    <div className="space-y-1.5 text-sm leading-relaxed">
      {text.split(/\n{1,}/).map((line, i) => {
        const bullet = /^\s*[-•*]\s+/.test(line);
        const parts = line.replace(/^\s*[-•*]\s+/, '').split(/(\*\*[^*]+\*\*|\[(?:hecho|cálculo|estadística|inferencia|opinión|hipótesis)\])/g);
        return (
          <p key={i} className={bullet ? 'pl-4 -indent-3' : ''}>
            {bullet && '• '}
            {parts.map((p, k) =>
              p.startsWith('**') ? (
                <b key={k}>{p.slice(2, -2)}</b>
              ) : /^\[(hecho|cálculo|estadística|inferencia|opinión|hipótesis)\]$/.test(p) ? (
                <span key={k} className="mx-0.5 rounded border border-accent-2/40 px-1 text-[10px] font-semibold text-accent-2">
                  {p.slice(1, -1)}
                </span>
              ) : (
                <span key={k}>{p}</span>
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}

export function CoachChat({ context, ready }: { context: string; ready: boolean }) {
  const [status, setStatus] = useState<{ configured: boolean; source: string; model: string }>();
  const [msgs, setMsgs] = useState<Msg[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORE_KEY) ?? '[]');
    } catch {
      return [];
    }
  });
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/coach/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ configured: false, source: 'none', model: '' }));
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-30)));
    } catch {
      /* storage unavailable */
    }
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [msgs]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const history = [...msgs.filter((m) => !m.error), { role: 'user' as const, content: q }];
    setMsgs([...history, { role: 'assistant', content: '' }]);
    setInput('');
    setBusy(true);
    try {
      const r = await fetch('/api/coach/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ context, messages: history.slice(-20).map(({ role, content }) => ({ role, content })) }),
      });
      if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let acc = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        const [text] = acc.split(/[\u0000\u0001]/);
        setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: text! }]);
      }
      const usageMatch = acc.split('\u0000')[1];
      const errMatch = acc.split('\u0001')[1];
      const text = acc.split(/[\u0000\u0001]/)[0]!.trim();
      setMsgs((m) => [
        ...m.slice(0, -1),
        errMatch ? { role: 'assistant', content: errMatch.trim(), error: true } : { role: 'assistant', content: text, usage: usageMatch ? JSON.parse(usageMatch) : undefined },
      ]);
    } catch (e) {
      setMsgs((m) => [...m.slice(0, -1), { role: 'assistant', content: `No se pudo contactar con el Coach: ${String(e)}`, error: true }]);
    } finally {
      setBusy(false);
    }
  };

  const total = msgs.reduce((s, m) => s + (m.usage ? costOf(m.usage) : 0), 0);

  if (status && !status.configured)
    return (
      <div className="panel p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <KeyRound size={16} className="text-accent" /> Coach con IA (Claude Sonnet 5.5)
        </div>
        <p className="text-sm text-muted">
          Para chatear necesitas una clave de API de Anthropic (se crea en <b>console.anthropic.com</b> → API Keys, con saldo de prepago). Pégala en{' '}
          <a href="#/settings" className="text-accent underline">
            Ajustes → Coach con IA
          </a>
          . Se guarda solo en tu PC y nunca se envía al navegador. Coste orientativo: unos 2–3 céntimos de dólar por pregunta.
        </p>
      </div>
    );

  return (
    <div className="panel flex flex-col">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <Bot size={17} className="text-accent" />
        <span className="font-semibold">Pregúntale al Coach</span>
        <span className="chip">Claude Sonnet 5.5</span>
        <span className="ml-auto text-[11px] text-faint">{total > 0 && `≈ $${total.toFixed(3)} esta conversación`}</span>
        {msgs.length > 0 && (
          <button className="btn btn-ghost p-1.5" title="Borrar conversación" onClick={() => setMsgs([])} disabled={busy}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
      <div className="max-h-[60vh] min-h-48 space-y-4 overflow-auto p-4">
        {msgs.length === 0 && (
          <div className="text-sm text-muted">
            <p className="mb-3">Conoce tu equipo activo, su análisis contra el meta y tu historial. Te va a llevar la contraria cuando haga falta. Prueba con:</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="btn text-xs" disabled={!ready} onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
            {!ready && <p className="mt-2 text-xs text-warn">Esperando a que termine el análisis del equipo…</p>}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${m.role === 'user' ? 'bg-panel-2' : 'bg-accent/20 text-accent'}`}>{m.role === 'user' ? <User size={14} /> : <Bot size={14} />}</span>
            <div className={`max-w-[85%] rounded-xl px-3.5 py-2.5 ${m.role === 'user' ? 'bg-accent/15' : m.error ? 'border border-bad/40 bg-bad/10 text-bad' : 'bg-panel-2'}`}>
              {m.content ? <Rich text={m.content} /> : <Loader2 size={15} className="animate-spin text-muted" />}
              {m.usage && <div className="mt-1.5 text-[10px] text-faint">≈ ${costOf(m.usage).toFixed(4)} · {m.usage.output} tokens</div>}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input h-11 resize-none"
          placeholder={ready ? 'Escribe tu pregunta… (Enter para enviar, Shift+Enter para salto de línea)' : 'Analizando tu equipo…'}
          value={input}
          disabled={!ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        <button className="btn btn-primary" disabled={busy || !input.trim() || !ready}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}
