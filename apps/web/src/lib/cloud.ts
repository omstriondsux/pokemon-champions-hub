import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { STATIC, setCloudHooks } from './api';

/**
 * Optional accounts (public web only), via Supabase Auth.
 *
 * - Security: passwords never touch this app's code paths beyond the sign-in call; Supabase hashes them,
 *   confirms the e-mail and rate-limits attempts. Login uses the PKCE flow (no tokens in the URL).
 *   The database only lets a signed-in user read/write their own rows (Row Level Security, supabase/schema.sql).
 * - Sync: every change is written to this browser first (instant, works offline) and then pushed to the
 *   account. On sign-in, the account and this browser are merged (newest version of each item wins).
 * - Privacy: on sign-out the local copy is cleared; another person signing in on this browser never
 *   inherits the previous user's data.
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const CLOUD = STATIC && !!URL_ && !!KEY;

const LOCAL_PREFIXES = ['pch.db.', 'pch.play.'];
const OWNER = 'pch.cloud.owner';
type Col = 'pokemon' | 'teams' | 'battles' | 'settings' | 'kv';

let clientP: Promise<SupabaseClient> | undefined;
export function sb(): Promise<SupabaseClient> {
  if (!CLOUD) return Promise.reject(new Error('Cuentas no configuradas'));
  clientP ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, KEY!, { auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }),
  );
  return clientP;
}

// ---------------------------------------------------------------- sync status (for the UI)
export type SyncState = 'off' | 'idle' | 'saving' | 'saved' | 'error';
let state: SyncState = 'off';
let lastError = '';
const listeners = new Set<() => void>();
const emit = (s: SyncState, err = '') => {
  state = s;
  lastError = err;
  listeners.forEach((f) => f());
};
export const syncState = () => ({ state, error: lastError });
export const onSync = (f: () => void) => (listeners.add(f), () => listeners.delete(f));

let userId: string | undefined;
let pending = 0;
async function run(op: (c: SupabaseClient) => Promise<{ error: { message: string } | null }>) {
  if (!userId) return;
  pending++;
  emit('saving');
  try {
    const { error } = await op(await sb());
    if (error) throw new Error(error.message);
    if (--pending === 0) emit('saved');
  } catch (e) {
    pending = Math.max(0, pending - 1);
    emit('error', e instanceof Error ? e.message : String(e));
  }
}
const push = (collection: Col, id: string, data: unknown) => run((c) => c.from('user_docs').upsert({ user_id: userId, collection, id, data }) as never);
const drop = (collection: Col, id: string) => run((c) => c.from('user_docs').delete().match({ user_id: userId, collection, id }) as never);

// every local write is mirrored to the account (api.ts calls these)
setCloudHooks({
  put: (c, doc) => void push(c, doc.id, doc),
  del: (c, id) => void drop(c, id),
  settings: (s) => void push('settings', 'main', s),
});
/** For small per-page preferences kept in localStorage (e.g. the teams chosen in "Contra la IA"). */
export function saveKv(key: string, value: unknown) {
  void push('kv', key, value);
}

// ---------------------------------------------------------------- local store helpers
const readLocal = (k: string) => {
  try {
    return JSON.parse(localStorage.getItem(k) ?? 'null');
  } catch {
    return null;
  }
};
const writeLocal = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* storage full / blocked */
  }
};
function clearLocal() {
  try {
    for (const k of Object.keys(localStorage)) if (LOCAL_PREFIXES.some((p) => k.startsWith(p))) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Merge the account with this browser: newest `updatedAt` wins; items only here are uploaded. */
async function pullAndMerge(uid: string) {
  const c = await sb();
  const rows: { collection: Col; id: string; data: Record<string, unknown> }[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await c.from('user_docs').select('collection,id,data').eq('user_id', uid).range(from, from + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const uploads: { collection: Col; id: string; data: unknown }[] = [];
  const newer = (a: unknown, b: unknown) => String((a as { updatedAt?: string })?.updatedAt ?? '') > String((b as { updatedAt?: string })?.updatedAt ?? '');

  for (const col of ['pokemon', 'teams', 'battles'] as const) {
    const local: Record<string, unknown> = readLocal(`pch.db.${col}`) ?? {};
    const remote = rows.filter((r) => r.collection === col);
    for (const r of remote) if (!local[r.id] || newer(r.data, local[r.id])) local[r.id] = r.data;
    for (const [id, d] of Object.entries(local)) {
      const r = remote.find((x) => x.id === id);
      if (!r || newer(d, r.data)) uploads.push({ collection: col, id, data: d });
    }
    writeLocal(`pch.db.${col}`, local);
  }
  // settings: account wins, but keep local keys the account doesn't have yet
  const remoteSettings = rows.find((r) => r.collection === 'settings' && r.id === 'main')?.data;
  const localSettings = readLocal('pch.db.settings') ?? {};
  const settings = { ...localSettings, ...(remoteSettings ?? {}) };
  writeLocal('pch.db.settings', settings);
  if (!remoteSettings && Object.keys(localSettings).length) uploads.push({ collection: 'settings', id: 'main', data: settings });
  // small preferences (kv)
  for (const r of rows.filter((x) => x.collection === 'kv')) writeLocal(r.id, r.data);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('pch.play.') && !rows.some((r) => r.collection === 'kv' && r.id === k)) uploads.push({ collection: 'kv', id: k, data: readLocal(k) });
  } catch {
    /* ignore */
  }
  for (let i = 0; i < uploads.length; i += 200) {
    const { error } = await c.from('user_docs').upsert(uploads.slice(i, i + 200).map((u) => ({ user_id: uid, ...u })));
    if (error) throw new Error(error.message);
  }
}

/**
 * Called when the session changes. Returns true when local data changed (the app must reload it).
 */
export async function adoptSession(session: Session | null): Promise<boolean> {
  const uid = session?.user.id;
  if (uid === userId) return false;
  const owner = readLocal(OWNER) as string | null;
  if (!uid) {
    // signed out: forget this browser's copy of the account
    userId = undefined;
    if (owner) {
      clearLocal();
      try {
        localStorage.removeItem(OWNER);
      } catch {
        /* ignore */
      }
      emit('off');
      return true;
    }
    emit('off');
    return false;
  }
  // another person's leftovers must never be merged into this account
  if (owner && owner !== uid) clearLocal();
  userId = uid;
  writeLocal(OWNER, uid);
  emit('saving');
  try {
    await pullAndMerge(uid);
    emit('saved');
  } catch (e) {
    emit('error', e instanceof Error ? e.message : String(e));
  }
  return true;
}

// ---------------------------------------------------------------- auth actions (Spanish errors)
const redirect = () => `${window.location.origin}${window.location.pathname}`;
function es(msg: string): string {
  if (/invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/email not confirmed/i.test(msg)) return 'Confirma tu correo: te enviamos un enlace al registrarte.';
  if (/already registered|already been registered/i.test(msg)) return 'Ya existe una cuenta con ese correo. Entra o recupera tu contraseña.';
  if (/rate limit|too many/i.test(msg)) return 'Demasiados intentos. Espera unos minutos y vuelve a probar.';
  if (/password should be|weak password|at least/i.test(msg)) return 'La contraseña es demasiado débil: usa al menos 8 caracteres, con letras y números.';
  if (/invalid email|valid email/i.test(msg)) return 'Ese correo no es válido.';
  return msg;
}
const strong = (pw: string) => pw.length >= 8 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);

export async function signIn(email: string, password: string) {
  const { error } = await (await sb()).auth.signInWithPassword({ email: email.trim(), password });
  if (error) throw new Error(es(error.message));
}
export async function signUp(email: string, password: string) {
  if (!strong(password)) throw new Error('Usa al menos 8 caracteres, con letras y números.');
  const { data, error } = await (await sb()).auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect() } });
  if (error) throw new Error(es(error.message));
  return { needsConfirmation: !data.session };
}
export async function sendReset(email: string) {
  const { error } = await (await sb()).auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect() });
  if (error) throw new Error(es(error.message));
}
export async function setNewPassword(password: string) {
  if (!strong(password)) throw new Error('Usa al menos 8 caracteres, con letras y números.');
  const { error } = await (await sb()).auth.updateUser({ password });
  if (error) throw new Error(es(error.message));
}
export async function signOut() {
  await (await sb()).auth.signOut();
}
/** Deletes the account and everything saved in it (server function, only for the signed-in user). */
export async function deleteAccount() {
  const c = await sb();
  const { error } = await c.rpc('delete_my_account');
  if (error) throw new Error(es(error.message));
  await c.auth.signOut();
}
