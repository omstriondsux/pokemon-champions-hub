import Anthropic from '@anthropic-ai/sdk';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import type { Hono } from 'hono';
import { streamText } from 'hono/streaming';
import { z } from 'zod';

/**
 * AI Coach — Claude Sonnet 5.5, called only from this local server so the API key never reaches the browser.
 * The key lives in data/secrets.json (git-ignored) or in ANTHROPIC_API_KEY / an `ant auth login` profile.
 *
 * Division of labour: every number comes from the deterministic engine (sent in `context`);
 * the model interprets, explains and debates, and must label what kind of claim it makes.
 */
const MODEL = 'claude-sonnet-5-5';

const SYSTEM = `Eres el Coach competitivo de "Champions Hub", una herramienta personal para Pokémon Champions (individuales y dobles, nivel 50, sistema de Stat Points: 66 en total y 32 como máximo por estadística, naturalezas llamadas "alineación").

Tu papel: entrenador crítico y honesto. Hablas en español, de tú, con frases claras y breves.

Reglas:
- Usa SOLO los datos del bloque CONTEXTO (calculados por el motor de la app con daño exacto y estadísticas de Smogon). No inventes porcentajes de uso, daños, velocidades ni resultados. Si falta un dato, dilo y sugiere qué pantalla de la app lo calcula (Calculadora, Speed Tiers, Battle Advisor, Build Optimizer, Squad Builder).
- Las estadísticas de uso vienen de Pokémon Showdown (simulador), no del juego oficial: no las presentes como datos oficiales.
- Etiqueta cada afirmación importante con una de estas marcas: [hecho], [cálculo], [estadística], [inferencia], [opinión], [hipótesis].
- Los índices 1v1 y las notas de la app son heurísticos: nunca los presentes como probabilidad de victoria.
- Si el usuario propone algo peor, dilo y explica por qué con los datos. Si su idea es mejor que la tuya, reconócelo.
- Con muestras pequeñas del historial (menos de ~10 combates) no saques conclusiones firmes.
- Cada recomendación debe responder: por qué es mejor, qué riesgo tiene y qué evidencia la apoya.
- No ayudes a usar asistencia externa durante torneos oficiales; para ranked casual y preparación, sí.
- Respuestas de 3 a 10 frases salvo que te pidan más detalle. Usa listas cortas cuando ayuden.`;

const SECRETS = (dataDir: string) => `${dataDir}/secrets.json`;

function readKey(dataDir: string): string | undefined {
  try {
    if (existsSync(SECRETS(dataDir))) return JSON.parse(readFileSync(SECRETS(dataDir), 'utf8')).anthropicApiKey || undefined;
  } catch {
    /* corrupt file: treat as missing */
  }
  return undefined;
}

function client(dataDir: string): Anthropic {
  const key = readKey(dataDir);
  // Without a saved key the SDK resolves ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN / an `ant auth login` profile.
  return key ? new Anthropic({ apiKey: key }) : new Anthropic();
}

const ChatBody = z.object({
  context: z.string().max(60_000),
  messages: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(8_000) }))
    .min(1)
    .max(40),
});

export function registerCoach(app: Hono, dataDir: string) {
  app.get('/api/coach/status', (c) => {
    const file = !!readKey(dataDir);
    const env = !!(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
    return c.json({ configured: file || env, source: file ? 'file' : env ? 'env' : 'none', model: MODEL });
  });

  app.put('/api/coach/key', async (c) => {
    const { key } = z.object({ key: z.string().trim().min(20).max(300) }).parse(await c.req.json());
    if (!key.startsWith('sk-ant-')) return c.json({ error: 'La clave debe empezar por sk-ant-' }, 400);
    writeFileSync(SECRETS(dataDir), JSON.stringify({ anthropicApiKey: key }));
    return c.json({ ok: true });
  });

  app.delete('/api/coach/key', (c) => {
    if (existsSync(SECRETS(dataDir))) rmSync(SECRETS(dataDir));
    return c.json({ ok: true });
  });

  app.post('/api/coach/chat', async (c) => {
    const body = ChatBody.parse(await c.req.json());
    if (body.messages[0]!.role !== 'user') return c.json({ error: 'La conversación debe empezar con el usuario' }, 400);
    return streamText(c, async (out) => {
      try {
        const anthropic = client(dataDir);
        const stream = anthropic.beta.messages.stream({
          model: MODEL,
          max_tokens: 16000,
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default', // if Sonnet 5.5 declines, the API retries on a fallback model
          output_config: { effort: 'medium' },
          system: [
            { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }, // stable prefix → cached
            { type: 'text', text: `CONTEXTO (generado por la app ahora mismo):\n${body.context}` },
          ],
          messages: body.messages,
        });
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') await out.write(event.delta.text);
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === 'refusal') await out.write('\n\n_(El modelo no quiso responder a esto. Reformula la pregunta.)_');
        else if (final.stop_reason === 'max_tokens') await out.write('\n\n_(Respuesta cortada por longitud.)_');
        const u = final.usage;
        await out.write(`\n\u0000${JSON.stringify({ input: u.input_tokens, cached: u.cache_read_input_tokens ?? 0, output: u.output_tokens, model: final.model })}`);
      } catch (err) {
        let msg = 'Error al contactar con Claude.';
        if (err instanceof Anthropic.AuthenticationError) msg = 'La clave de API no es válida. Revísala en Ajustes → Coach con IA.';
        else if (err instanceof Anthropic.PermissionDeniedError) msg = 'Tu clave no tiene permiso para este modelo.';
        else if (err instanceof Anthropic.RateLimitError) msg = 'Límite de uso alcanzado: espera un momento y vuelve a intentarlo.';
        else if (err instanceof Anthropic.APIError) msg = `Error de la API (${err.status ?? '—'}): ${err.message}`;
        else if (String(err).includes('apiKey') || String(err).includes('API key') || String(err).includes('authentication')) msg = 'No hay clave de API configurada. Añádela en Ajustes → Coach con IA.';
        await out.write(`\n\u0001${msg}`);
      }
    });
  });
}
