import { useEffect, useRef, useState } from 'react';
import { Cloud, CloudOff, Eye, EyeOff, Loader2, LogIn, LogOut, Check, AlertTriangle } from 'lucide-react';
import { useApp } from '../lib/app';
import { onSync, sendReset, setNewPassword, signIn, signOut, signUp, syncState, type SyncState } from '../lib/cloud';
import { Modal, Segmented } from './ui';

export function useSyncState() {
  const [s, setS] = useState(syncState());
  useEffect(() => {
    const off = onSync(() => setS(syncState()));
    return () => void off();
  }, []);
  return s;
}

const SYNC_TEXT: Record<SyncState, string> = {
  off: 'Sin sincronizar',
  idle: 'Listo',
  saving: 'Guardando…',
  saved: 'Guardado en tu cuenta',
  error: 'No se pudo guardar',
};

export function SyncBadge({ compact }: { compact?: boolean }) {
  const { state, error } = useSyncState();
  const Icon = state === 'saving' ? Loader2 : state === 'error' ? AlertTriangle : state === 'saved' ? Check : state === 'off' ? CloudOff : Cloud;
  return (
    <span className={`inline-flex items-center gap-1 text-xs ${state === 'error' ? 'text-bad' : state === 'saved' ? 'text-good' : 'text-muted'}`} title={error || SYNC_TEXT[state]}>
      <Icon size={13} className={state === 'saving' ? 'animate-spin' : ''} />
      {!compact && SYNC_TEXT[state]}
    </span>
  );
}

/** Top-bar entry: "Entrar" when signed out; the account (with save status) when signed in. */
export function AccountButton() {
  const { account } = useApp();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const f = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener('mousedown', f);
    return () => document.removeEventListener('mousedown', f);
  }, []);
  if (!account.enabled) return null;
  if (!account.email)
    return (
      <>
        <button className="btn btn-primary py-1 text-xs" onClick={() => setOpen(true)}>
          <LogIn size={14} /> Entrar
        </button>
        {open && <AuthModal onClose={() => setOpen(false)} />}
      </>
    );
  return (
    <div className="relative" ref={ref}>
      <button className="btn btn-ghost flex items-center gap-1.5 p-1" onClick={() => setMenu((m) => !m)} title={account.email}>
        <span className="grid h-7 w-7 place-items-center rounded-full bg-accent text-xs font-bold text-white">{account.email[0]!.toUpperCase()}</span>
        <SyncBadge compact />
      </button>
      {menu && (
        <div className="absolute right-0 z-40 mt-1 w-64 rounded-xl border border-line bg-panel p-3 shadow-xl">
          <div className="truncate text-sm font-semibold">{account.email}</div>
          <div className="mt-1">
            <SyncBadge />
          </div>
          <p className="mt-2 text-[11px] text-faint">Todo lo que cambias se guarda en tu cuenta y lo ves en cualquier dispositivo.</p>
          <button className="btn mt-3 w-full text-sm" onClick={() => void signOut()}>
            <LogOut size={14} /> Cerrar sesión
          </button>
        </div>
      )}
    </div>
  );
}

function PasswordField({ value, onChange, autoComplete, placeholder }: { value: string; onChange: (v: string) => void; autoComplete: string; placeholder: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input className="input pr-9" type={show ? 'text' : 'password'} autoComplete={autoComplete} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} required minLength={8} />
      <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 text-muted" onClick={() => setShow((s) => !s)} aria-label={show ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
        {show ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
}

export function AuthModal({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<'login' | 'signup' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(undefined);
    try {
      if (tab === 'login') {
        await signIn(email, pw);
        onClose();
      } else if (tab === 'signup') {
        const r = await signUp(email, pw);
        if (r.needsConfirmation) setMsg({ ok: true, text: `Te enviamos un correo a ${email}. Abre el enlace para activar tu cuenta y luego entra.` });
        else onClose();
      } else {
        await sendReset(email);
        setMsg({ ok: true, text: 'Si existe una cuenta con ese correo, te llegará un enlace para crear una contraseña nueva.' });
      }
    } catch (err) {
      setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Tu cuenta de Champions Hub" onClose={onClose}>
      <p className="mb-3 text-sm text-muted">Con una cuenta, tus Pokémon, builds, equipos, historial y ajustes se guardan solos y los ves en el móvil y en el PC. Lo que ya tienes en este navegador se guarda en tu cuenta al entrar.</p>
      <Segmented
        value={tab}
        onChange={(t) => {
          setTab(t);
          setMsg(undefined);
        }}
        options={[
          { value: 'login', label: 'Entrar' },
          { value: 'signup', label: 'Crear cuenta' },
          { value: 'reset', label: 'Olvidé mi contraseña' },
        ]}
      />
      <form className="mt-4 space-y-3" onSubmit={submit}>
        <input className="input" type="email" autoComplete="email" placeholder="Tu correo" value={email} onChange={(e) => setEmail(e.target.value)} required />
        {tab !== 'reset' && <PasswordField value={pw} onChange={setPw} autoComplete={tab === 'login' ? 'current-password' : 'new-password'} placeholder={tab === 'signup' ? 'Contraseña (8+ caracteres, letras y números)' : 'Contraseña'} />}
        {msg && <p className={`rounded-lg p-2.5 text-sm ${msg.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>{msg.text}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />} {tab === 'login' ? 'Entrar' : tab === 'signup' ? 'Crear cuenta' : 'Enviar enlace'}
        </button>
        <p className="text-[11px] text-faint">Tu contraseña la protege Supabase (cifrada, nunca se guarda en esta web). Solo tú puedes ver tus datos.</p>
      </form>
    </Modal>
  );
}

/** After opening a password-reset link. */
export function RecoveryModal() {
  const { recovery, endRecovery } = useApp();
  const [pw, setPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>();
  if (!recovery) return null;
  return (
    <Modal title="Crea tu contraseña nueva" onClose={endRecovery}>
      <form
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await setNewPassword(pw);
            setMsg({ ok: true, text: 'Contraseña cambiada. Ya estás dentro.' });
            setTimeout(endRecovery, 1200);
          } catch (err) {
            setMsg({ ok: false, text: err instanceof Error ? err.message : String(err) });
          } finally {
            setBusy(false);
          }
        }}
      >
        <PasswordField value={pw} onChange={setPw} autoComplete="new-password" placeholder="Contraseña nueva (8+ caracteres, letras y números)" />
        {msg && <p className={`rounded-lg p-2.5 text-sm ${msg.ok ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad'}`}>{msg.text}</p>}
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy && <Loader2 size={15} className="animate-spin" />} Guardar contraseña
        </button>
      </form>
    </Modal>
  );
}
