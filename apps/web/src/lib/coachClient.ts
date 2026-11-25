import { COACH_MODEL, COACH_SYSTEM } from '@pch/engine/coach';
import { STATIC } from './api';

/**
 * AI Coach transport.
 *  - Local app: the key stays on the local server (data/secrets.json) and the browser only sees text.
 *  - Public web: there is no server, so each visitor uses THEIR OWN Anthropic key, kept in their
 *    browser (localStorage) and sent only to api.anthropic.com. The site owner never pays for or sees it.
 */
export interface CoachStatus {
  configured: boolean;
  source: 'file' | 'env' | 'browser' | 'none';
  model: string;
}
export interface CoachUsage {
  input: number;
  cached: number;
  output: number;
  model: string;
}
export type ChatMsg = { role: 'user' | 'assistant'; content: string };

const KEY = 'pch.anthropicKey';
const readLocalKey = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

export async function coachStatus(): Promise<CoachStatus> {
  if (STATIC) return { configured: !!readLocalKey(), source: readLocalKey() ? 'browser' : 'none', model: COACH_MODEL };
  return fetch('/api/coach/status')
    .then((r) => r.json())
    .catch(() => ({ configured: false, source: 'none', model: '' }));
}

export async function saveCoachKey(key: string): Promise<{ ok: boolean; error?: string }> {
  const k = key.trim();
  if (STATIC) {
    if (!k.startsWith('sk-ant-')) return { ok: false, error: 'La clave debe empezar por sk-ant-' };
    try {
      localStorage.setItem(KEY, k);
      return { ok: true };
    } catch {
      return { ok: false, error: 'Este navegador no permite guardar datos.' };
    }
  }
  const r = await fetch('/api/coach/key', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: k }) });
  const b = await r.json().catch(() => ({}));
  return r.ok ? { ok: true } : { ok: false, error: b.error ?? 'Clave no válida.' };
}

export async function removeCoachKey() {
  if (STATIC) {
    try {
      localStorage.removeItem(KEY);
    } catch {
      /* ignore */
    }
    return;
  }
  await fetch('/api/coach/key', { method: 'DELETE' });
}

/** Streams the answer through `onText` (accumulated text). Resolves with the final text and usage; throws a user-facing message. */
export async function streamCoach(context: string, messages: ChatMsg[], onText: (text: string) => void): Promise<{ text: string; usage?: CoachUsage }> {
  return STATIC ? streamBrowser(context, messages, onText) : streamServer(context, messages, onText);
}

async function streamServer(context: string, messages: ChatMsg[], onText: (t: string) => void) {
  const r = await fetch('/api/coach/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ context, messages }) });
  if (!r.ok || !r.body) throw new Error((await r.json().catch(() => ({}))).error ?? r.statusText);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let acc = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += dec.decode(value, { stream: true });
    onText(acc.split(/[\u0000\u0001]/)[0]!);
  }
  const err = acc.split('\u0001')[1];
  if (err) throw new Error(err.trim());
  const usage = acc.split('\u0000')[1];
  return { text: acc.split(/[\u0000\u0001]/)[0]!.trim(), usage: usage ? (JSON.parse(usage) as CoachUsage) : undefined };
}

async function streamBrowser(context: string, messages: ChatMsg[], onText: (t: string) => void) {
  const apiKey = readLocalKey();
  if (!apiKey) throw new Error('No hay clave de API configurada. Añádela en Ajustes → Coach con IA.');
  // Loaded on demand so visitors who never use the chat don't download the SDK.
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const anthropic = new Anthropic({ apiKey, dangerouslyAllowBrowser: true }); // visitor's own key, in their own browser
  let text = '';
  try {
    const stream = anthropic.beta.messages.stream({
      model: COACH_MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'medium' },
      system: [
        { type: 'text', text: COACH_SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: `CONTEXTO (generado por la app ahora mismo):\n${context}` },
      ],
      messages,
    });
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        text += event.delta.text;
        onText(text);
      }
    }
    const final = await stream.finalMessage();
    if (final.stop_reason === 'refusal') text += '\n\n_(El modelo no quiso responder a esto. Reformula la pregunta.)_';
    else if (final.stop_reason === 'max_tokens') text += '\n\n_(Respuesta cortada por longitud.)_';
    const u = final.usage;
    return { text: text.trim(), usage: { input: u.input_tokens, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens, model: final.model } };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new Error('La clave de API no es válida. Revísala en Ajustes → Coach con IA.');
    if (err instanceof Anthropic.PermissionDeniedError) throw new Error('Tu clave no tiene permiso para este modelo.');
    if (err instanceof Anthropic.RateLimitError) throw new Error('Límite de uso alcanzado: espera un momento y vuelve a intentarlo.');
    if (err instanceof Anthropic.APIError) throw new Error(`Error de la API (${err.status ?? '—'}): ${err.message}`);
    throw new Error(`No se pudo contactar con Claude: ${String(err)}`);
  }
}
