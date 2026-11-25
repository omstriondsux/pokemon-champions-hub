import { useRef, useState } from 'react';
import { Download, Upload } from 'lucide-react';
import { useApp } from '../lib/app';
import { api } from '../lib/api';
import { Badge, PageHeader, Segmented } from '../components/ui';

function unverifiedRules(obj: unknown, path: string[] = [], out: { path: string; confidence: string; note?: string }[] = []) {
  if (!obj || typeof obj !== 'object') return out;
  const o = obj as Record<string, unknown>;
  if ('confidence' in o && 'value' in o) {
    if (o.confidence !== 'verified') out.push({ path: path.join('.'), confidence: String(o.confidence), note: o.note as string | undefined });
    return out;
  }
  for (const [k, v] of Object.entries(o)) unverifiedRules(v, [...path, k], out);
  return out;
}

export default function Settings() {
  const { settings, saveSettings, regulation, regulations, metaIndex, reload, t } = useApp();
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>();
  const cutoffs = [...new Set(metaIndex.map((m) => m.ratingCutoff))].sort((a, b) => a - b);

  const doExport = async () => {
    const data = await api.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `champions-hub-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const doImport = async (file: File, mode: 'merge' | 'replace') => {
    try {
      const r = await api.importAll(JSON.parse(await file.text()), mode);
      await reload();
      setMsg(`Importado (${mode === 'merge' ? 'fusionar' : 'reemplazar'}): ${Object.entries(r.imported).map(([k, v]) => `${v} ${k}`).join(', ')}`);
    } catch (e) {
      setMsg(`Error: ${String(e)}`);
    }
  };

  return (
    <div className="fade-up max-w-4xl">
      <PageHeader title={t('nav.settings')} />
      <div className="panel mb-4 grid gap-5 p-5 md:grid-cols-2">
        <Field label="Idioma (interfaz y nombres de movimientos, habilidades y objetos)">
          <Segmented value={settings.lang} onChange={(lang) => saveSettings({ lang })} options={[{ value: 'es', label: 'Español' }, { value: 'en', label: 'English' }]} />
        </Field>
        <Field label="Tema">
          <Segmented value={settings.theme} onChange={(theme) => saveSettings({ theme })} options={[{ value: 'dark', label: 'Oscuro' }, { value: 'light', label: 'Claro' }]} />
        </Field>
        <Field label="Modo por defecto">
          <Segmented value={settings.defaultMode} onChange={(defaultMode) => saveSettings({ defaultMode })} options={[{ value: 'doubles', label: 'Dobles' }, { value: 'singles', label: 'Individuales' }]} />
        </Field>
        <Field label="Corte de rating de las estadísticas" hint="Más alto = jugadores más fuertes, pero muestra más pequeña.">
          <select className="input w-40" value={settings.ratingCutoff} onChange={(e) => saveSettings({ ratingCutoff: Number(e.target.value) })}>
            {cutoffs.map((c) => (
              <option key={c} value={c}>
                {c === 0 ? 'Todos' : `≥ ${c}`}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Coste en VP por Stat Point" hint="Las fuentes no coinciden (2 o 5 VP). Indica el que ves en tu juego.">
          <input className="input num w-40" type="number" min={0} value={settings.vpCostPerPoint ?? ''} onChange={(e) => saveSettings({ vpCostPerPoint: e.target.value === '' ? null : Number(e.target.value) })} placeholder="sin definir" />
        </Field>
      </div>

      <div className="panel mb-4 p-5">
        <div className="panel-title mb-3">Copias de seguridad</div>
        <p className="mb-3 text-sm text-muted">
          El servidor guarda una copia diaria automática de la base de datos en <code className="num">data/backups</code> (las últimas 14). Aquí puedes exportar e importar todo (inventario, equipos, historial y ajustes) en JSON.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn" onClick={doExport}>
            <Download size={15} /> Exportar JSON
          </button>
          <input ref={fileRef} type="file" accept="application/json" className="hidden" onChange={(e) => e.target.files?.[0] && doImport(e.target.files[0], (fileRef.current!.dataset.mode as 'merge' | 'replace') ?? 'merge')} />
          <button className="btn" onClick={() => ((fileRef.current!.dataset.mode = 'merge'), fileRef.current!.click())}>
            <Upload size={15} /> Importar (fusionar)
          </button>
          <button className="btn text-bad" onClick={() => confirm('Reemplazar borra el inventario, los equipos y el historial actuales y los sustituye por el archivo. ¿Continuar?') && ((fileRef.current!.dataset.mode = 'replace'), fileRef.current!.click())}>
            <Upload size={15} /> Importar (reemplazar)
          </button>
        </div>
        {msg && <p className="mt-2 text-sm text-muted">{msg}</p>}
      </div>

      <div className="panel p-5">
        <div className="panel-title mb-3">Paquetes de regulación</div>
        {regulations.map((r) => {
          const rules = unverifiedRules(r.pack);
          return (
            <div key={r.id} className="mb-4">
              <div className="mb-1 font-semibold">
                {r.pack.name} {r.id === regulation.id && <span className="text-xs text-accent">· activa</span>}
              </div>
              <div className="mb-2 text-xs text-muted">
                {r.pack.validFrom.value} → {r.pack.validTo.value} · paquete v{r.pack.packVersion} · base de datos {r.pack.dataBase.calc}
              </div>
              <table className="w-full text-xs">
                <tbody>
                  {rules.map((x) => (
                    <tr key={x.path} className="border-t border-line">
                      <td className="py-1 pr-2 align-top">
                        <Badge level={x.confidence} />
                      </td>
                      <td className="num py-1 pr-2 align-top text-text">{x.path}</td>
                      <td className="py-1 text-muted">{x.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        <p className="text-xs text-faint">Para una regulación nueva, añade su JSON en data/regulations (ver README). La app no inventa reglas: lo no publicado queda como «supuesto».</p>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
      {hint && <p className="mt-1 text-[11px] text-faint">{hint}</p>}
    </div>
  );
}
