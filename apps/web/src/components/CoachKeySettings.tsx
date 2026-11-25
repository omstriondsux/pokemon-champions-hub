import { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Trash2 } from 'lucide-react';

/** Saves the Anthropic API key on the local server (data/secrets.json). The key is never read back. */
export function CoachKeySettings() {
  const [status, setStatus] = useState<{ configured: boolean; source: string; model: string }>();
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState<string>();
  const load = () => fetch('/api/coach/status').then((r) => r.json()).then(setStatus);
  useEffect(() => {
    load();
  }, []);

  const save = async () => {
    const r = await fetch('/api/coach/key', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
    const b = await r.json().catch(() => ({}));
    setMsg(r.ok ? 'Clave guardada en tu PC.' : (b.error ?? 'Clave no válida.'));
    if (r.ok) setKey('');
    load();
  };
  const remove = async () => {
    await fetch('/api/coach/key', { method: 'DELETE' });
    setMsg('Clave eliminada.');
    load();
  };

  return (
    <div className="panel mb-4 p-5">
      <div className="panel-title mb-3 flex items-center gap-2">
        <KeyRound size={14} /> Coach con IA (Claude Sonnet 5.5)
      </div>
      {status?.configured ? (
        <p className="mb-3 flex items-center gap-1.5 text-sm text-good">
          <CheckCircle2 size={15} /> Configurado {status.source === 'env' ? '(variable de entorno del sistema)' : '(clave guardada en este PC)'}
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
        {status?.source === 'file' && (
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
