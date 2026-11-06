import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx, Modal } from './ui';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}
interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
}

interface FeedbackApi {
  toast: (message: string, kind?: ToastKind) => void;
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
}

const FeedbackContext = createContext<FeedbackApi>(null!);

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<(v: boolean) => void>(() => {});
  const seq = useRef(0);

  const toast = useCallback((message: string, kind: ToastKind = 'success') => {
    const id = ++seq.current;
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const confirm = useCallback((opts: ConfirmOptions) => {
    setConfirmState(opts);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (v: boolean) => {
    setConfirmState(null);
    resolver.current(v);
  };

  const icons = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <FeedbackContext.Provider value={{ toast, confirm }}>
      {children}
      {createPortal(
        <div className="pointer-events-none fixed top-16 right-4 z-[70] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
          {toasts.map((t) => {
            const Icon = icons[t.kind];
            return (
              <div
                key={t.id}
                className={cx(
                  'pointer-events-auto flex items-start gap-3 rounded-xl border bg-white px-4 py-3 text-sm shadow-lg',
                  t.kind === 'success' && 'border-emerald-200',
                  t.kind === 'error' && 'border-rose-200',
                  t.kind === 'info' && 'border-brand-200',
                )}
              >
                <Icon className={cx('mt-0.5 size-4 shrink-0', t.kind === 'success' ? 'text-emerald-600' : t.kind === 'error' ? 'text-rose-600' : 'text-brand-600')} />
                <span className="text-slate-700">{t.message}</span>
              </div>
            );
          })}
        </div>,
        document.body,
      )}
      <Modal
        open={!!confirmState}
        onClose={() => close(false)}
        size="sm"
        footer={
          <>
            <button className="btn btn-secondary" onClick={() => close(false)}>
              Batal
            </button>
            <button className={cx('btn', confirmState?.danger ? 'btn-danger' : 'btn-primary')} onClick={() => close(true)} autoFocus>
              {confirmState?.confirmLabel ?? 'Ya, lanjutkan'}
            </button>
          </>
        }
      >
        <div className="flex gap-4">
          <div className={cx('h-fit rounded-full p-2', confirmState?.danger ? 'bg-rose-100 text-rose-600' : 'bg-brand-100 text-brand-600')}>
            <AlertTriangle className="size-5" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{confirmState?.title}</h3>
            {confirmState?.message && <div className="mt-1 text-sm text-slate-600">{confirmState.message}</div>}
          </div>
        </div>
      </Modal>
    </FeedbackContext.Provider>
  );
}

export const useFeedback = () => useContext(FeedbackContext);
