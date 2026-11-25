import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { getSpecies, STAT_IDS, toID, type StatTable } from '@pch/engine';
import { itemIconUrl, previewSpecies, spriteUrl, TYPE_COLORS } from '../lib/pokemon';
import { useApp } from '../lib/app';
import type { NameKind } from '../lib/i18n';

export function Sprite({ species, size = 56, kind = 'home', className = '' }: { species: string; size?: number; kind?: 'home' | 'icon'; className?: string }) {
  // Fallback chain: requested set → other set → base species (new Champions megas often lack sprites).
  const base = getSpecies(species)?.baseSpecies;
  const chain = [spriteUrl(species, kind), spriteUrl(species, kind === 'home' ? 'icon' : 'home'), ...(base && base !== species ? [spriteUrl(base, kind)] : [])];
  const [step, setStep] = useState(0);
  useEffect(() => setStep(0), [species, kind]);
  if (!species || step >= chain.length)
    return (
      <div style={{ width: size, height: size }} className={`grid place-items-center rounded-lg bg-panel-2 text-faint ${className}`}>
        ?
      </div>
    );
  return <img src={chain[step]} alt={species} width={size} height={size} loading="lazy" onError={() => setStep((s) => s + 1)} className={`object-contain ${className}`} style={{ width: size, height: size, imageRendering: chain[step]!.includes('/gen5/') ? 'pixelated' : 'auto' }} />;
}

export function ItemIcon({ item }: { item?: string }) {
  const [err, setErr] = useState(false);
  if (!item || err) return null;
  return <img src={itemIconUrl(item)} alt="" width={20} height={20} onError={() => setErr(true)} className="inline-block" style={{ imageRendering: 'pixelated' }} />;
}

export function TypeBadge({ type, small }: { type: string; small?: boolean }) {
  const { names } = useApp();
  return (
    <span className={`inline-block rounded font-display font-bold tracking-wider text-white uppercase ${small ? 'px-1.5 text-[10px]' : 'px-2 py-0.5 text-[11px]'}`} style={{ background: TYPE_COLORS[type] ?? '#666', textShadow: '0 1px 1px rgba(0,0,0,.35)' }}>
      {names.type(type)}
    </span>
  );
}

export function Types({ species, small }: { species: string; small?: boolean }) {
  const s = getSpecies(species);
  if (!s) return null;
  return (
    <span className="inline-flex gap-1">
      {s.types.map((t) => (
        <TypeBadge key={t} type={t} small={small} />
      ))}
    </span>
  );
}

const CONF_STYLE: Record<string, string> = {
  verified: 'border-good/40 text-good',
  reported: 'border-accent-2/40 text-accent-2',
  assumed: 'border-warn/40 text-warn',
  disputed: 'border-bad/40 text-bad',
  high: 'border-good/40 text-good',
  medium: 'border-accent-2/40 text-accent-2',
  low: 'border-warn/40 text-warn',
  hypothesis: 'border-bad/40 text-bad',
  simulator: 'border-accent-2/40 text-accent-2',
};
const CONF_LABEL: Record<string, string> = {
  verified: 'verificado',
  reported: 'reportado',
  assumed: 'supuesto',
  disputed: 'en disputa',
  high: 'muestra alta',
  medium: 'muestra media',
  low: 'muestra baja',
  hypothesis: 'hipótesis',
  simulator: 'simulador',
};
export function Badge({ level, title }: { level: string; title?: string }) {
  return (
    <span title={title} className={`chip ${CONF_STYLE[level] ?? ''}`}>
      {CONF_LABEL[level] ?? level}
    </span>
  );
}

const STAT_LABEL: Record<string, string> = { hp: 'PS', atk: 'Atq', def: 'Def', spa: 'AtE', spd: 'DfE', spe: 'Vel' };
export function StatBars({ stats, base, sp, max = 220 }: { stats: StatTable; base?: StatTable; sp?: StatTable; max?: number }) {
  return (
    <div className="grid gap-1">
      {STAT_IDS.map((s) => {
        const v = stats[s];
        const hue = Math.min(140, (v / max) * 140);
        return (
          <div key={s} className="grid grid-cols-[32px_36px_1fr_28px] items-center gap-2 text-xs">
            <span className="text-muted">{STAT_LABEL[s]}</span>
            <span className="num text-right font-semibold">{v}</span>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.min(100, (v / max) * 100)}%`, background: `hsl(${hue} 70% 52%)` }} />
            </div>
            <span className="num text-right text-faint" title={base ? `Base ${base[s]}` : undefined}>
              {sp ? (sp[s] ? `+${sp[s]}` : '') : base?.[s]}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export interface ComboOption {
  value: string;
  label: string;
  sub?: string;
  keys: string[];
  icon?: ReactNode;
}

/** Keyboard-first search: type a few letters, Enter picks the top match. */
export function Combobox({
  options,
  value,
  onChange,
  placeholder,
  autoFocus,
  clearOnSelect,
  inputRef,
  onEnterEmpty,
}: {
  options: ComboOption[];
  value?: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  clearOnSelect?: boolean;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onEnterEmpty?: () => void;
}) {
  // A stored value that is not an option (e.g. an item unavailable in this regulation) is still shown,
  // so the user can see what is wrong instead of an empty field.
  const selected = options.find((o) => o.value === value) ?? (value ? { value, label: value, keys: [] } : undefined);
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const ownRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? ownRef;

  const filtered = useMemo(() => {
    const id = toID(q);
    if (!id) return options.slice(0, 40);
    const starts: ComboOption[] = [];
    const contains: ComboOption[] = [];
    for (const o of options) {
      if (o.keys.some((k) => k.startsWith(id))) starts.push(o);
      else if (o.keys.some((k) => k.includes(id))) contains.push(o);
    }
    return [...starts, ...contains].slice(0, 40);
  }, [q, options]);

  useEffect(() => setHi(0), [q]);

  const pick = (o: ComboOption) => {
    onChange(o.value);
    setQ('');
    setOpen(false);
    if (!clearOnSelect) ref.current?.blur();
  };

  return (
    <div className="relative">
      <input
        ref={ref}
        autoFocus={autoFocus}
        className="input"
        placeholder={selected && !clearOnSelect ? selected.label : placeholder}
        value={open || clearOnSelect ? q : selected?.label ?? ''}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, filtered.length - 1)));
          else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
          else if (e.key === 'Enter') {
            e.preventDefault();
            if (!q && onEnterEmpty) return onEnterEmpty();
            const o = filtered[hi];
            if (o) pick(o);
          } else if (e.key === 'Escape') (setOpen(false), setQ(''));
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-lg border border-line-strong bg-panel p-1 shadow-2xl shadow-black/40">
          {filtered.map((o, i) => (
            <li
              key={o.value}
              onMouseDown={(e) => (e.preventDefault(), pick(o))}
              onMouseEnter={() => setHi(i)}
              className={`flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm ${i === hi ? 'bg-accent/15 text-text' : 'text-muted'}`}
            >
              {o.icon}
              <span className="flex-1 truncate">{o.label}</span>
              {o.sub && <span className="text-[11px] text-faint">{o.sub}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function useSpeciesOptions(list?: string[]): ComboOption[] {
  const { names } = useApp();
  return useMemo(
    () =>
      (list ?? previewSpecies()).map((s) => ({
        value: s,
        label: names.species(s),
        keys: names.searchKeys('species', s),
        icon: <Sprite species={s} size={28} kind="icon" />,
        sub: getSpecies(s)?.types.join('/'),
      })),
    [list, names],
  );
}

export function useNameOptions(kind: NameKind, list: string[]): ComboOption[] {
  const { names } = useApp();
  return useMemo(() => {
    const tr = { species: names.species, moves: names.move, abilities: names.ability, items: names.item, natures: names.nature, types: names.type }[kind];
    return list.map((v) => ({ value: v, label: tr(v), sub: tr(v) !== v ? v : undefined, keys: names.searchKeys(kind, v) }));
  }, [kind, list, names]);
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div className={`panel fade-up max-h-[92vh] w-full overflow-auto p-5 ${wide ? 'max-w-5xl' : 'max-w-xl'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold tracking-wide">{title}</h2>
          <button className="btn btn-ghost p-1" onClick={onClose} aria-label="Cerrar">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-3xl font-bold tracking-wide">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-line-strong p-8 text-center text-sm text-muted">{children}</div>;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-line-strong bg-panel-2 p-0.5">
      {options.map((o) => (
        <button key={o.value} onClick={() => onChange(o.value)} className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${value === o.value ? 'bg-accent text-white' : 'text-muted hover:text-text'}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScoreBar({ value }: { value: number }) {
  // value in [-1, 1]
  const color = value >= 0.25 ? 'var(--good)' : value <= -0.25 ? 'var(--bad)' : 'var(--warn)';
  return (
    <div className="relative h-1.5 w-full rounded-full bg-panel-2">
      <div className="absolute top-0 left-1/2 h-full w-px bg-line-strong" />
      <div className="absolute top-0 h-full rounded-full" style={{ left: value >= 0 ? '50%' : `${50 + value * 50}%`, width: `${Math.abs(value) * 50}%`, background: color }} />
    </div>
  );
}

export const scoreColor = (v: number) => (v >= 0.25 ? 'text-good' : v <= -0.25 ? 'text-bad' : 'text-warn');
export const signed = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`;
