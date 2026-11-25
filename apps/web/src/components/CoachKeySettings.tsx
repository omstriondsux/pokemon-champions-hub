import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Trash2 } from 'lucide-react';
import { STATIC } from '../lib/api';
import { coachStatus, removeCoachKey, saveCoachKey, type CoachStatus } from '../lib/coachClient';

/** Saves the Anthropic API key: on the local server (local app) or in this browser only (public web). The key is never shown again. */
export function CoachKeySettings() {
  const [status, setStatus] = useState<CoachStatus>();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string>();
  const load = () => coachStatus().then(setStatus);
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    const r = await saveCoachKey(key);
    setMsg(r.ok ? (STATIC ? 'Clave guardada en este navegador.' : 'Clave guardada en tu PC.') : (r.error ?? 'Clave no válida.'));
    if (r.ok) setKey('');
    load();
  };
  const remove = async () => {
    await removeCoachKey();
    setMsg('Clave eliminada.');
    load();
  };

  const where = { env: '(variable de entorno del sistema)', file: '(clave guardada en este PC)', browser: '(clave guardada en este navegador)', none: '' } as const;

  return (
    <div className="panel mb-4 p-5">
      <div className="panel-title mb-3 flex items-center gap-2">
        <KeyRound size={14} /> Coach con IA (Claude Sonnet 5.5) · opcional
      </div>
      {status?.configured ? (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-good">
          <CheckCircle2 size={15} /> Configurado {where[status.source]}
        </p>
      ) : STATIC ? (
        <p className="mb-3 text-sm text-muted">
          Todo lo demás de la web es gratis y funciona sin esto. Para el chat con IA usas <b>tu propia</b> clave de Anthropic (se crea en <b>console.anthropic.com</b> → API Keys, con saldo de prepago). Se guarda solo en este navegador y se envía únicamente a la API de Anthropic. No la uses en un ordenador compartido.
        </p>
      ) : (
        <p className="mb-3 text-sm text-muted">
          Crea una clave en <b>console.anthropic.com</b> → API Keys (necesita saldo de prepago) y pégala aquí. Se guarda solo en <code className="num">data/secrets.json</code> de tu PC, no se sube a ningún sitio y la app nunca la vuelve a mostrar.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <input className="input max-w-md" type="password" autoComplete="off" placeholder="sk-ant-…" value={key} onChange={(e) => setKey(e.target.value)} />
        <button className="btn btn-primary" disabled={key.trim().length < 20} onClick={save}>
          Guardar clave
        </button>
        {(status?.source === 'file' || status?.source === 'browser') && (
          <button className="btn text-bad" onClick={remove}>
            <Trash2 size={14} /> Quitar clave
          </button>
        )}
      </div>
      {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      <p className="mt-3 text-[11px] text-faint">Precio de Claude Sonnet 5.5: $2 por millón de tokens de entrada y $10 por millón de salida. Una pregunta típica cuesta unos 2–3 céntimos de dólar; cada respuesta muestra su coste aproximado.</p>
    </div>
  );
}
