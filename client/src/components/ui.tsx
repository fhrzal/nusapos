import { AlertTriangle, ChevronLeft, ChevronRight, Inbox, Loader2, Search, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

export function Spinner({ className = 'size-4' }: { className?: string }) {
  return <Loader2 className={cx('animate-spin', className)} />;
}

export function Loading({ label = 'Memuat data…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-500">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
      <AlertTriangle className="size-4 shrink-0" />
      <span className="flex-1">{message}</span>
      {onRetry && (
        <button className="btn btn-sm btn-secondary" onClick={onRetry}>
          Coba lagi
        </button>
      )}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }: { icon?: LucideIcon; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-slate-100 p-3 text-slate-400">
        <Icon className="size-6" />
      </div>
      <p className="font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

const TONES = {
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  blue: 'bg-brand-50 text-brand-700 ring-brand-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  cyan: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
};
export type Tone = keyof typeof TONES;

export function Badge({ tone = 'gray', children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cx('badge', TONES[tone], className)}>{children}</span>;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative mt-0.5 inline-flex h-5 w-9 shrink-0 rounded-full transition', checked ? 'bg-brand-600' : 'bg-slate-300')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
      <span>
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = 'Cari…', className, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; autoFocus?: boolean }) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
      <input className="input pl-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} autoFocus={autoFocus} />
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  delta,
  icon: Icon,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  delta?: number | null;
  icon?: LucideIcon;
  tone?: 'blue' | 'green' | 'amber' | 'violet' | 'red' | 'cyan';
}) {
  const iconTone = {
    blue: 'bg-brand-50 text-brand-600',
    green: 'bg-emerald-50 text-emerald-600',
    amber: 'bg-amber-50 text-amber-600',
    violet: 'bg-violet-50 text-violet-600',
    red: 'bg-rose-50 text-rose-600',
    cyan: 'bg-cyan-50 text-cyan-600',
  }[tone];
  return (
    <div className="card p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">{label}</p>
        {Icon && (
          <span className={cx('rounded-lg p-1.5', iconTone)}>
            <Icon className="size-4" />
          </span>
        )}
      </div>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 tabular-nums">{value}</p>
      <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
        {delta !== undefined && delta !== null && Number.isFinite(delta) && (
          <span className={cx('font-semibold', delta >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
            {delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
          </span>
        )}
        {sub}
      </div>
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={cx(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition',
            value === t.key ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-slate-100 px-1.5 text-[11px] text-slate-600">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  const from = total ? (page - 1) * limit + 1 : 0;
  return (
    <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-sm text-slate-500">
      <span className="tabular-nums">
        {from.toLocaleString('id-ID')}–{Math.min(page * limit, total).toLocaleString('id-ID')} dari {total.toLocaleString('id-ID')}
      </span>
      <div className="flex items-center gap-1">
        <button className="btn btn-sm btn-ghost" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Sebelumnya">
          <ChevronLeft className="size-4" />
        </button>
        <span className="px-2 tabular-nums">
          {page} / {pages}
        </span>
        <button className="btn btn-sm btn-ghost" disabled={page >= pages} onClick={() => onChange(page + 1)} aria-label="Berikutnya">
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Modal
const modalStack: string[] = [];

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = 'md',
  children,
  footer,
  dismissable = true,
  bodyClassName,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
  children: ReactNode;
  footer?: ReactNode;
  dismissable?: boolean;
  bodyClassName?: string;
}) {
  const id = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    modalStack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable && modalStack[modalStack.length - 1] === id) {
        e.preventDefault();
        e.stopPropagation();
        closeRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      modalStack.splice(modalStack.indexOf(id), 1);
    };
  }, [open, id, dismissable]);

  if (!open) return null;
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', '2xl': 'max-w-6xl', full: 'max-w-[96vw]' }[size];
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/50 p-4 backdrop-blur-[2px] sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && dismissable && onClose()}>
      <div className={cx('relative my-auto flex max-h-[94vh] w-full flex-col rounded-2xl bg-white shadow-2xl', width)} role="dialog" aria-modal="true">
        {title && (
          <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-slate-900">{title}</h2>
              {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
            </div>
            {dismissable && (
              <button className="-mr-2 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={onClose} aria-label="Tutup">
                <X className="size-5" />
              </button>
            )}
          </div>
        )}
        <div className={cx('flex-1 overflow-y-auto px-6 py-5', bodyClassName)}>{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-6 py-3.5 rounded-b-2xl">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('rounded border border-current/25 px-1 py-px font-mono text-[10px] font-semibold opacity-80', className)}>{children}</kbd>;
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium text-slate-800">{children}</span>
    </div>
  );
}
