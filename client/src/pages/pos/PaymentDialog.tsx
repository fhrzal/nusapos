import { PAYMENT_METHODS, type PaymentMethod } from '@shared/types';
import { Banknote, CreditCard, Gift, QrCode, Star, Trash2, Wallet, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { cx, Kbd, Modal, Spinner } from '../../components/ui';
import { money, parseNumber, rp } from '../../lib/format';

export interface PaymentLine {
  method: PaymentMethod;
  amount: number;
  reference?: string;
}

const ICONS: Record<PaymentMethod, LucideIcon> = {
  CASH: Banknote,
  DEBIT: CreditCard,
  CREDIT: CreditCard,
  QRIS: QrCode,
  EWALLET: Wallet,
  VOUCHER: Gift,
  POINTS: Star,
};

function cashSuggestions(remaining: number): number[] {
  if (remaining <= 0) return [];
  const set = new Set<number>([remaining]);
  for (const step of [1000, 5000, 10000, 20000, 50000, 100000]) set.add(Math.ceil(remaining / step) * step);
  set.add(Math.ceil(remaining / 100000) * 100000 + 100000);
  return [...set].sort((a, b) => a - b).slice(0, 6);
}

export default function PaymentDialog({
  open,
  total,
  member,
  pointValue,
  onClose,
  onConfirm,
}: {
  open: boolean;
  total: number;
  member: { name: string; points: number } | null;
  pointValue: number;
  onClose: () => void;
  onConfirm: (payments: PaymentLine[]) => Promise<void>;
}) {
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const refRef = useRef<HTMLInputElement>(null);

  const paid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = total - paid;
  const change = Math.max(0, -remaining);
  const def = PAYMENT_METHODS.find((m) => m.code === method)!;
  const maxPoints = member ? member.points * pointValue : 0;
  const pointsUsed = payments.filter((p) => p.method === 'POINTS').reduce((s, p) => s + p.amount, 0);

  useEffect(() => {
    if (open) {
      setPayments([]);
      setMethod('CASH');
      setAmount('');
      setReference('');
      setError(null);
      setBusy(false);
    }
  }, [open]);

  useEffect(() => {
    if (open) requestAnimationFrame(() => amountRef.current?.select());
  }, [open, method, payments.length]);

  const selectMethod = (m: PaymentMethod) => {
    if (m === 'POINTS' && !member) return setError('Pembayaran poin hanya untuk member');
    setMethod(m);
    setError(null);
    setReference('');
    if (m !== 'CASH' && remaining > 0) {
      const max = m === 'POINTS' ? Math.min(remaining - (remaining % pointValue), maxPoints - pointsUsed) : remaining;
      setAmount(max > 0 ? String(max) : '');
    } else setAmount('');
    requestAnimationFrame(() => amountRef.current?.select());
  };

  const addPayment = (value?: number) => {
    setError(null);
    if (remaining <= 0) return setError('Pembayaran sudah lunas. Tekan Enter untuk menyelesaikan.');
    let amt = value ?? (amount.trim() ? parseNumber(amount) : remaining);
    if (!Number.isFinite(amt) || amt <= 0) return setError(remaining <= 0 ? null : 'Nominal tidak valid');
    amt = Math.round(amt);
    if (method !== 'CASH' && amt > remaining) amt = remaining;
    if (method === 'POINTS') {
      if (amt % pointValue) amt -= amt % pointValue;
      if (amt > maxPoints - pointsUsed) return setError(`Poin tidak cukup (maks ${rp(maxPoints - pointsUsed)})`);
      if (amt <= 0) return setError('Nominal poin terlalu kecil');
    }
    if (def.requiresReference && !reference.trim()) {
      setError(`Masukkan no. referensi / approval ${def.label}`);
      refRef.current?.focus();
      return;
    }
    setPayments((p) => [...p, { method, amount: amt, reference: reference.trim() || undefined }]);
    setAmount('');
    setReference('');
    if (method !== 'CASH') setMethod('CASH');
  };

  const finish = async () => {
    if (remaining > 0) return setError(`Pembayaran masih kurang ${rp(remaining)}`);
    setBusy(true);
    setError(null);
    try {
      await onConfirm(payments);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const fIdx = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7'].indexOf(e.key);
    if (fIdx >= 0) {
      e.preventDefault();
      selectMethod(PAYMENT_METHODS[fIdx].code);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (busy) return;
      if (!amount.trim() && remaining <= 0) finish();
      else addPayment();
    }
  };

  const suggestions = useMemo(() => cashSuggestions(remaining), [remaining]);

  return (
    <Modal open={open} onClose={() => !busy && onClose()} size="xl" dismissable={!busy} bodyClassName="p-0">
      <div className="grid md:grid-cols-[220px_1fr_300px]" onKeyDown={onKeyDown}>
        <div className="space-y-1.5 border-r border-slate-100 bg-slate-50 p-4">
          <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Metode Bayar</p>
          {PAYMENT_METHODS.map((m, i) => {
            const Icon = ICONS[m.code];
            const disabled = m.code === 'POINTS' && !member;
            return (
              <button
                key={m.code}
                disabled={disabled}
                onClick={() => selectMethod(m.code)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition disabled:opacity-40',
                  method === m.code ? 'bg-brand-600 text-white shadow' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-brand-300',
                )}
              >
                <Icon className="size-4" />
                <span className="flex-1">{m.label}</span>
                <Kbd>F{i + 1}</Kbd>
              </button>
            );
          })}
        </div>

        <div className="space-y-4 p-6">
          <div>
            <p className="text-xs font-semibold tracking-wide text-slate-500 uppercase">Total Belanja</p>
            <p className="text-4xl font-extrabold tracking-tight text-slate-900 tabular-nums">{rp(total)}</p>
          </div>
          <label className="block">
            <span className="label">Nominal {def.label}</span>
            <input
              ref={amountRef}
              className="input py-3 text-right font-mono text-2xl font-bold"
              inputMode="numeric"
              placeholder={remaining > 0 ? money(remaining) : '0'}
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
            />
          </label>
          {def.requiresReference && (
            <label className="block">
              <span className="label">No. Referensi / Approval Code</span>
              <input ref={refRef} className="input font-mono" value={reference} onChange={(e) => setReference(e.target.value.toUpperCase())} placeholder="Dari struk EDC / aplikasi" maxLength={50} />
            </label>
          )}
          {method === 'POINTS' && member && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Saldo poin {member.name}: <b>{money(member.points)}</b> poin (= {rp(member.points * pointValue)}). 1 poin = {rp(pointValue)}.
            </p>
          )}
          {method === 'QRIS' && <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Tampilkan QRIS di perangkat EDC/display pelanggan, lalu masukkan nomor referensi transaksi.</p>}
          {method === 'CASH' && remaining > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {suggestions.map((s, i) => (
                <button key={s} className="btn btn-secondary py-3 font-mono" onClick={() => addPayment(s)}>
                  {i === 0 ? 'Uang Pas' : money(s)}
                </button>
              ))}
            </div>
          )}
          <div className="flex gap-2">
            <button className="btn btn-secondary flex-1" onClick={() => addPayment()} disabled={remaining <= 0 && !amount}>
              Tambah Pembayaran <Kbd>Enter</Kbd>
            </button>
          </div>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">{error}</p>}
        </div>

        <div className="flex flex-col border-l border-slate-100 bg-slate-900 p-5 text-white md:rounded-r-2xl">
          <p className="text-xs font-semibold tracking-wide text-slate-400 uppercase">Rincian Pembayaran</p>
          <ul className="mt-3 flex-1 space-y-2">
            {payments.map((p, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{PAYMENT_METHODS.find((m) => m.code === p.method)?.label}</p>
                  {p.reference && <p className="font-mono text-xs text-slate-400">{p.reference}</p>}
                </div>
                <span className="font-mono">{money(p.amount)}</span>
                <button className="rounded p-1 text-slate-400 hover:text-rose-400" onClick={() => setPayments(payments.filter((_, j) => j !== i))} aria-label="Hapus">
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
            {!payments.length && <li className="text-sm text-slate-500">Belum ada pembayaran.</li>}
          </ul>
          <div className="mt-4 space-y-1 border-t border-white/10 pt-4 font-mono text-sm">
            <div className="flex justify-between text-slate-300">
              <span>Dibayar</span>
              <span>{money(paid)}</span>
            </div>
            <div className="flex justify-between text-slate-300">
              <span>Sisa</span>
              <span className={remaining > 0 ? 'text-amber-300' : ''}>{money(Math.max(0, remaining))}</span>
            </div>
          </div>
          <div className="mt-3 rounded-xl bg-emerald-500/15 p-3">
            <p className="text-xs font-semibold tracking-wide text-emerald-300 uppercase">Kembalian</p>
            <p className="font-mono text-3xl font-bold text-emerald-300">{money(change)}</p>
          </div>
          <button className="btn btn-success btn-lg mt-4 w-full" onClick={finish} disabled={remaining > 0 || busy}>
            {busy ? <Spinner /> : null} Selesaikan <Kbd className="text-white">Enter</Kbd>
          </button>
        </div>
      </div>
    </Modal>
  );
}
