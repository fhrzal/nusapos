import { CASH_DENOMINATIONS, CASH_MOVEMENT_LABELS, PAYMENT_LABELS, type CashMovementType, type PaymentMethod } from '@shared/types';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  CreditCard,
  Lock,
  Printer,
  RotateCcw,
  UserPlus,
  Vault,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CameraButton } from '../../components/CameraScanner';
import { Receipt, ShiftReport, usePrint, type ReceiptSettings } from '../../components/Print';
import { NumberInput, StatusBadge, SupervisorDialog, type Approval } from '../../components/shared';
import { Badge, cx, Field, Kbd, Modal, Spinner } from '../../components/ui';
import { get, post } from '../../lib/api';
import { fmtDateTime, fmtTime, maskMember, money, num, parseNumber, qty as fmtQty, rp } from '../../lib/format';
import { useDebounced } from '../../lib/hooks';

export interface Member {
  id: number;
  member_no: string;
  name: string;
  phone: string;
  tier: string;
  points: number;
}

// ---------------------------------------------------------------- Ubah qty
export function QtyDialog({ open, title, initial, weighted, onClose, onSubmit }: { open: boolean; title: string; initial: number; weighted: boolean; onClose: () => void; onSubmit: (qty: number) => void }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setValue(initial ? String(initial).replace('.', ',') : '');
      setError(null);
    }
  }, [open, initial]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = parseNumber(value);
    if (!Number.isFinite(n) || n < 0) return setError('Jumlah tidak valid');
    if (!weighted && !Number.isInteger(n)) return setError('Jumlah harus bilangan bulat');
    if (n > 9999) return setError('Jumlah terlalu besar');
    onSubmit(Math.round(n * 1000) / 1000);
  };
  return (
    <Modal open={open} onClose={onClose} size="sm" title={title}>
      <form onSubmit={submit} className="space-y-3">
        <Field label={weighted ? 'Berat (kg)' : 'Jumlah'} hint={weighted ? 'Gunakan koma untuk desimal, mis. 0,750' : 'Isi 0 untuk menghapus baris'}>
          <input className="input py-3 text-center font-mono text-3xl font-bold" value={value} onChange={(e) => setValue(e.target.value)} autoFocus onFocus={(e) => e.target.select()} inputMode="decimal" />
        </Field>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button className="btn btn-primary w-full">
          Simpan <Kbd className="text-white">Enter</Kbd>
        </button>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Member
export function MemberDialog({ open, current, onClose, onSelect, canCreate }: { open: boolean; current: Member | null; onClose: () => void; onSelect: (m: Member | null) => void; canCreate: boolean }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Member | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<'search' | 'create'>('search');
  const [form, setForm] = useState({ name: '', phone: '' });

  useEffect(() => {
    if (open) {
      setQ('');
      setFound(null);
      setError(null);
      setMode('search');
      setForm({ name: '', phone: '' });
    }
  }, [open]);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (found) return onSelect(found);
    setBusy(true);
    setError(null);
    try {
      setFound(await get<Member>('/members/lookup', { q: q.trim() }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onSelect(await post<Member>('/members', form));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="md" title="Member" subtitle="Scan kartu member atau ketik nomor HP pelanggan.">
      {current && (
        <div className="mb-4 flex items-center justify-between rounded-lg bg-brand-50 px-4 py-3 text-sm">
          <span>
            Aktif: <b>{current.name}</b> ({maskMember(current.member_no)})
          </span>
          <button className="btn btn-sm btn-secondary" onClick={() => onSelect(null)}>
            Lepas Member
          </button>
        </div>
      )}
      {mode === 'search' ? (
        <form onSubmit={search} className="space-y-3">
          <div className="flex gap-2">
            <input className="input py-3 font-mono text-lg" placeholder="No. kartu / No. HP" value={q} onChange={(e) => (setQ(e.target.value), setFound(null))} autoFocus />
            <CameraButton
              className="px-3.5"
              title="Scan Kartu Member"
              onDetected={async (code) => {
                const m = await get<Member>('/members/lookup', { q: code });
                setQ(code);
                setFound(m);
                setError(null);
                return m.name;
              }}
            />
          </div>
          {found && (
            <div className="rounded-xl bg-gradient-to-br from-slate-900 to-brand-900 p-5 text-white shadow-lg">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold tracking-widest text-slate-300 uppercase">Member {found.tier}</span>
                <CreditCard className="size-5 text-slate-300" />
              </div>
              <p className="mt-4 font-mono text-lg tracking-widest">{found.member_no.replace(/(\d{4})/g, '$1 ')}</p>
              <div className="mt-3 flex items-end justify-between">
                <div>
                  <p className="font-semibold">{found.name}</p>
                  <p className="text-xs text-slate-300">{found.phone}</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-slate-300">Poin</p>
                  <p className="font-mono text-xl font-bold">{money(found.points)}</p>
                </div>
              </div>
            </div>
          )}
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            {canCreate && (
              <button type="button" className="btn btn-secondary" onClick={() => setMode('create')}>
                <UserPlus className="size-4" /> Daftar Baru
              </button>
            )}
            <button className="btn btn-primary flex-1" disabled={busy || !q.trim()}>
              {busy && <Spinner />} {found ? 'Gunakan Member Ini' : 'Cari'} <Kbd className="text-white">Enter</Kbd>
            </button>
          </div>
        </form>
      ) : (
        <form onSubmit={create} className="space-y-3">
          <Field label="Nama lengkap">
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus required />
          </Field>
          <Field label="No. HP" hint="Dipakai sebagai identitas member di kasir.">
            <input className="input font-mono" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="08xxxxxxxxxx" required />
          </Field>
          {error && <p className="text-sm text-rose-600">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setMode('search')}>
              Kembali
            </button>
            <button className="btn btn-primary flex-1" disabled={busy}>
              {busy && <Spinner />} Daftarkan & Gunakan
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Tunda / panggil transaksi
export function HoldDialog({ open, onClose, onSubmit }: { open: boolean; onClose: () => void; onSubmit: (label: string) => void }) {
  const [label, setLabel] = useState('');
  useEffect(() => {
    if (open) setLabel('');
  }, [open]);
  return (
    <Modal open={open} onClose={onClose} size="sm" title="Tunda Transaksi">
      <form onSubmit={(e) => (e.preventDefault(), onSubmit(label))} className="space-y-3">
        <Field label="Keterangan (opsional)" hint="Mis. nama/ciri pelanggan agar mudah dipanggil kembali.">
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={40} autoFocus />
        </Field>
        <button className="btn btn-primary w-full">Tunda Transaksi</button>
      </form>
    </Modal>
  );
}

export function HeldDialog({ open, terminalId, onClose, onRecall }: { open: boolean; terminalId: number; onClose: () => void; onRecall: (data: any) => void }) {
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setRows(null);
    get<any[]>('/pos/held', { terminal_id: terminalId })
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [open, terminalId]);
  const recall = async (id: number) => {
    try {
      const held = await post(`/pos/held/${id}/recall`);
      onRecall(held.data);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Panggil Transaksi Tertunda" subtitle="Transaksi tertunda dapat dipanggil dari terminal mana pun di toko ini.">
      {error && <p className="mb-3 text-sm text-rose-600">{error}</p>}
      {!rows ? (
        <div className="py-8 text-center">
          <Spinner className="mx-auto size-5" />
        </div>
      ) : rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-slate-500">Tidak ada transaksi tertunda.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {rows.map((h, i) => {
            const lines = h.data.lines ?? [];
            const total = lines.reduce((s: number, l: any) => s + l.qty * l.product.sell_price, 0);
            return (
              <li key={h.id}>
                <button className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-brand-50" onClick={() => recall(h.id)} autoFocus={i === 0}>
                  <span className="grid size-8 place-items-center rounded-full bg-slate-100 text-sm font-bold text-slate-600">{i + 1}</span>
                  <div className="flex-1">
                    <p className="font-medium text-slate-900">{h.label || `Transaksi #${h.id}`}</p>
                    <p className="text-xs text-slate-500">
                      {h.terminal_code} · {h.user_name} · {fmtDateTime(h.created_at)} · {lines.length} item
                      {h.data.member && ` · Member ${h.data.member.name}`}
                    </p>
                  </div>
                  <span className="font-mono font-semibold">{money(total)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- Kas masuk / keluar / pickup
export function CashDialog({ open, shiftId, onClose, onDone }: { open: boolean; shiftId: number; onClose: () => void; onDone: (summary: any) => void }) {
  const [type, setType] = useState<CashMovementType>('PICKUP');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('');
  const [approveOpen, setApproveOpen] = useState(false);
  useEffect(() => {
    if (open) {
      setAmount(0);
      setReason('');
    }
  }, [open]);
  const submit = async (approval: Approval) => {
    const r = await post(`/shifts/${shiftId}/cash`, { type, amount, reason, approval });
    onDone(r.summary);
  };
  const items: [CashMovementType, LucideIcon, string][] = [
    ['PICKUP', Vault, 'Setor uang dari laci ke brankas'],
    ['CASH_IN', ArrowDownToLine, 'Tambahan modal / uang kecil'],
    ['CASH_OUT', ArrowUpFromLine, 'Pengeluaran kas kecil toko'],
  ];
  return (
    <>
      <Modal open={open && !approveOpen} onClose={onClose} size="md" title="Mutasi Kas Laci" subtitle="Setiap mutasi kas memerlukan otorisasi supervisor.">
        <form onSubmit={(e) => (e.preventDefault(), setApproveOpen(true))} className="space-y-4">
          <div className="grid grid-cols-3 gap-2">
            {items.map(([t, Icon, desc]) => (
              <button key={t} type="button" onClick={() => setType(t)} className={cx('rounded-xl border p-3 text-left transition', type === t ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-500/20' : 'border-slate-200 hover:border-slate-300')}>
                <Icon className="size-5 text-brand-600" />
                <p className="mt-1.5 text-sm font-semibold">{CASH_MOVEMENT_LABELS[t]}</p>
                <p className="text-[11px] text-slate-500">{desc}</p>
              </button>
            ))}
          </div>
          <Field label="Nominal">
            <NumberInput value={amount} onChange={setAmount} className="py-3 font-mono text-xl font-bold" autoFocus />
          </Field>
          <Field label="Keterangan">
            <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mis. Setoran ke brankas jam 14.00" required minLength={3} />
          </Field>
          <button className="btn btn-primary w-full" disabled={amount <= 0 || reason.trim().length < 3}>
            Lanjut Otorisasi
          </button>
        </form>
      </Modal>
      <SupervisorDialog
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        onSubmit={submit}
        description={`${CASH_MOVEMENT_LABELS[type]} ${rp(amount)}`}
      />
    </>
  );
}

// ---------------------------------------------------------------- Riwayat transaksi: cetak ulang, void, retur
interface HistoryRow {
  id: number;
  receipt_no: string;
  created_at: string;
  total: number;
  item_count: number;
  status: string;
  member_name: string | null;
  cashier_name: string;
  methods: string | null;
  return_count: number;
}

export function HistoryDialog({
  open,
  shiftId,
  terminalId,
  settings,
  onClose,
  onChanged,
}: {
  open: boolean;
  shiftId: number;
  terminalId: number;
  settings: ReceiptSettings;
  onClose: () => void;
  onChanged: (msg: string) => void;
}) {
  const [scope, setScope] = useState<'shift' | 'terminal'>('shift');
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 200);
  const [data, setData] = useState<{ rows: HistoryRow[]; summary: { count: number; total: number; voided: number } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [sale, setSale] = useState<any>(null);
  const [tick, setTick] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const rows = data?.rows ?? [];

  useEffect(() => {
    if (open) {
      setQ('');
      setScope('shift');
      setSale(null);
      setActive(0);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    get('/pos/history', { terminal_id: terminalId, shift_id: shiftId, scope, q: dq })
      .then((d) => alive && (setData(d), setError(null)))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, scope, dq, tick, shiftId, terminalId]);

  useEffect(() => setActive(0), [scope, dq]);

  const selectedId = rows[active]?.id;
  useEffect(() => {
    if (!open || !selectedId) return;
    let alive = true;
    get(`/sales/${selectedId}`)
      .then((s) => alive && setSale(s))
      .catch((e) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [open, selectedId, tick]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  // Nomor struk yang tidak ada di daftar (shift/hari lain) dicari langsung, mis. untuk retur.
  const findReceipt = async () => {
    const no = q.trim().toUpperCase();
    if (!no || rows.length) return;
    try {
      setSale(await get(`/sales/receipt/${encodeURIComponent(no)}`));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Barcode di bagian bawah struk berisi nomor struk.
  const scanReceipt = async (code: string) => {
    const s = await get<any>(`/sales/receipt/${encodeURIComponent(code.trim().toUpperCase())}`);
    setQ(s.receipt_no);
    setSale(s);
    setError(null);
    return `${s.receipt_no} · ${rp(s.total)}`;
  };

  return (
    <Modal open={open} onClose={onClose} size="2xl" title="Riwayat Transaksi" subtitle="Pilih transaksi untuk cetak ulang, void, atau retur. Struk lama: ketik nomor struk lengkap lalu Enter." bodyClassName="p-0">
      <div className="grid h-[72vh] grid-cols-[380px_minmax(0,1fr)]">
        <div className="flex min-h-0 flex-col border-r border-slate-100">
          <div className="space-y-2 border-b border-slate-100 p-3">
            <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1">
              {(
                [
                  ['shift', 'Shift ini'],
                  ['terminal', 'Terminal hari ini'],
                ] as const
              ).map(([k, l]) => (
                <button key={k} onClick={() => setScope(k)} className={cx('rounded-md py-1.5 text-sm font-medium', scope === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500')}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                className="input font-mono"
                placeholder="No. struk / nama member…"
                value={q}
                autoFocus
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(rows.length - 1, a + 1)));
                  if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
                  if (e.key === 'Enter') (e.preventDefault(), findReceipt());
                }}
              />
              <CameraButton title="Scan Barcode Struk" hint="Arahkan barcode di bagian bawah struk ke dalam bingkai." onDetected={scanReceipt} />
            </div>
            {data && (
              <p className="text-xs text-slate-500">
                {num(data.summary.count)} transaksi · {rp(data.summary.total)}
                {data.summary.voided > 0 && ` · ${data.summary.voided} void`}
              </p>
            )}
          </div>
          <div ref={listRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
            {rows.map((r, i) => (
              <button
                key={r.id}
                data-idx={i}
                onClick={() => setActive(i)}
                className={cx('block w-full border-b border-slate-100 px-4 py-2.5 text-left', i === active && sale?.id === r.id ? 'bg-brand-50' : i === active ? 'bg-slate-50' : 'hover:bg-slate-50')}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs font-semibold text-slate-700">{r.receipt_no}</span>
                  <span className={cx('font-mono font-semibold', r.status === 'VOIDED' && 'text-slate-400 line-through')}>{money(r.total)}</span>
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
                  <span>{fmtTime(r.created_at)}</span>
                  <span>·</span>
                  <span>{fmtQty(r.item_count)} item</span>
                  <span>·</span>
                  <span className="truncate">
                    {String(r.methods ?? '')
                      .split(',')
                      .map((m) => PAYMENT_LABELS[m as PaymentMethod] ?? m)
                      .join(', ')}
                  </span>
                  {r.status === 'VOIDED' && <Badge tone="red">Void</Badge>}
                  {r.return_count > 0 && <Badge tone="amber">Retur</Badge>}
                </div>
                {(r.member_name || scope === 'terminal') && (
                  <div className="truncate text-xs text-slate-400">
                    {scope === 'terminal' && r.cashier_name}
                    {r.member_name && `${scope === 'terminal' ? ' · ' : ''}Member ${r.member_name}`}
                  </div>
                )}
              </button>
            ))}
            {data && !rows.length && (
              <p className="px-4 py-10 text-center text-sm text-slate-500">
                {!q ? 'Belum ada transaksi.' : sale?.receipt_no === q.trim().toUpperCase() ? 'Struk dari shift atau hari lain — detail di sebelah kanan.' : 'Tidak ditemukan. Tekan Enter untuk mencari nomor struk.'}
              </p>
            )}
            {!data && !error && (
              <div className="py-10 text-center">
                <Spinner className="mx-auto size-5 text-slate-400" />
              </div>
            )}
          </div>
        </div>
        <div className="thin-scroll min-h-0 overflow-y-auto p-5">
          {error && <p className="mb-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          {sale ? (
            <SaleDetailPanel
              sale={sale}
              shiftId={shiftId}
              settings={settings}
              onChanged={(updated, msg) => {
                setSale(updated);
                setTick((t) => t + 1);
                onChanged(msg);
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-slate-400">Pilih transaksi di daftar.</div>
          )}
        </div>
      </div>
    </Modal>
  );
}

function SaleDetailPanel({ sale, shiftId, settings, onChanged }: { sale: any; shiftId: number; settings: ReceiptSettings; onChanged: (sale: any, msg: string) => void }) {
  const print = usePrint();
  const [mode, setMode] = useState<'view' | 'return'>('view');
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [reason, setReason] = useState('');
  const [approval, setApproval] = useState<null | 'void' | 'return'>(null);

  useEffect(() => {
    setMode('view');
    setReturnQty({});
    setReason('');
  }, [sale.id]);

  const canVoid = sale.status === 'COMPLETED' && sale.shift_id === shiftId && sale.returns.length === 0;
  const refundTotal = sale.items.reduce((s: number, i: any) => s + (returnQty[i.id] ? Math.round((i.net * returnQty[i.id]) / i.qty) : 0), 0);

  const doVoid = async (a: Approval) => {
    const r = await post(`/sales/${sale.id}/void`, { reason, approval: a });
    onChanged(r, `Transaksi ${r.receipt_no} berhasil di-void`);
  };
  const doReturn = async (a: Approval) => {
    const items = Object.entries(returnQty)
      .filter(([, q]) => q > 0)
      .map(([id, q]) => ({ sale_item_id: Number(id), qty: q }));
    const r = await post(`/sales/${sale.id}/return`, { shift_id: shiftId, reason, items, approval: a });
    onChanged(r.sale, `Retur ${r.return.return_no} berhasil. Serahkan uang refund ${rp(r.return.total_refund)} kepada pelanggan.`);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono font-semibold">{sale.receipt_no}</span>
        <StatusBadge status={sale.status} />
        {sale.returns.length > 0 && <Badge tone="amber">{sale.returns.length} retur</Badge>}
        <span className="ml-auto font-mono text-xl font-bold">{rp(sale.total)}</span>
      </div>
      <p className="-mt-2 text-sm text-slate-500">
        {fmtDateTime(sale.created_at)} · {sale.cashier_name} · {sale.terminal_code}
        {sale.member_name && ` · Member ${sale.member_name}`}
      </p>
      <table className="tbl rounded-lg border border-slate-200">
        <thead>
          <tr>
            <th>Barang</th>
            <th className="num">Qty</th>
            <th className="num">Diretur</th>
            <th className="num">Nilai Bersih</th>
            {mode === 'return' && <th className="num w-32">Qty Retur</th>}
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i: any) => {
            const remaining = Math.round((i.qty - i.returned_qty) * 1000) / 1000;
            return (
              <tr key={i.id}>
                <td>
                  {i.name}
                  {i.promo_name && <div className="text-xs text-emerald-600">{i.promo_name}</div>}
                </td>
                <td className="num">{fmtQty(i.qty, i.is_weighted)}</td>
                <td className="num text-slate-500">{i.returned_qty ? fmtQty(i.returned_qty, i.is_weighted) : '—'}</td>
                <td className="num">{money(i.net)}</td>
                {mode === 'return' && (
                  <td>
                    <NumberInput
                      value={returnQty[i.id] ?? 0}
                      decimals={i.is_weighted ? 3 : 0}
                      disabled={remaining <= 0}
                      onChange={(v) => setReturnQty({ ...returnQty, [i.id]: Math.min(v, remaining) })}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="text-sm text-slate-600">
        Pembayaran: {sale.payments.map((p: any) => `${PAYMENT_LABELS[p.method as PaymentMethod]} ${money(p.amount)}`).join(', ')} · Kembalian {money(sale.change_amount)}
      </p>
      {sale.status === 'VOIDED' && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">Void oleh {sale.voided_by_name}: {sale.void_reason}</p>}
      {(mode === 'return' || canVoid) && (
        <Field label={mode === 'return' ? 'Alasan retur' : 'Alasan (wajib untuk void)'}>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={mode === 'return' ? 'Mis. kemasan rusak, kedaluwarsa' : 'Mis. pelanggan batal membeli'} />
        </Field>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button className="btn btn-secondary" onClick={() => print(<Receipt sale={sale} settings={settings} copy />)}>
          <Printer className="size-4" /> Cetak Ulang
        </button>
        {mode === 'view' && canVoid && (
          <button className="btn btn-danger" disabled={reason.trim().length < 5} onClick={() => setApproval('void')}>
            Void Transaksi
          </button>
        )}
        {mode === 'view' && sale.status === 'COMPLETED' && (
          <button className="btn btn-primary" onClick={() => setMode('return')}>
            <RotateCcw className="size-4" /> Proses Retur
          </button>
        )}
        {mode === 'return' && (
          <>
            <button className="btn btn-secondary" onClick={() => setMode('view')}>
              Batal
            </button>
            <button className="btn btn-primary" disabled={refundTotal <= 0 || reason.trim().length < 5} onClick={() => setApproval('return')}>
              Refund Tunai {rp(refundTotal)}
            </button>
          </>
        )}
      </div>
      <SupervisorDialog
        open={!!approval}
        onClose={() => setApproval(null)}
        onSubmit={approval === 'void' ? doVoid : doReturn}
        description={approval === 'void' ? `Void struk ${sale.receipt_no} senilai ${rp(sale.total)}` : `Retur ${sale.receipt_no}, refund ${rp(refundTotal)}`}
      />
    </div>
  );
}

// ---------------------------------------------------------------- Tutup shift (blind count)
export function CloseShiftDialog({
  open,
  shiftId,
  settings,
  onClose,
  onClosed,
  forced,
  requireApproval,
  ownerName,
}: {
  open: boolean;
  shiftId: number;
  settings: ReceiptSettings;
  onClose: () => void;
  onClosed: () => void;
  /** Jam shift habis: dialog tidak dapat dibatalkan. */
  forced?: boolean;
  /** Menutup shift kasir lain: wajib otorisasi supervisor. */
  requireApproval?: boolean;
  ownerName?: string;
}) {
  const print = usePrint();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [approveOpen, setApproveOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setCounts({});
      setNote('');
      setResult(null);
      setError(null);
    }
  }, [open]);

  const total = CASH_DENOMINATIONS.reduce((s, d) => s + d * (counts[d] ?? 0), 0);
  const close = async (approval?: Approval) => {
    const r = await post(`/shifts/${shiftId}/close`, { denominations: counts, note: note || undefined, approval });
    setResult(r);
    print(<ShiftReport summary={r} settings={settings} />);
  };
  const submit = async () => {
    if (requireApproval) return setApproveOpen(true);
    setBusy(true);
    setError(null);
    try {
      await close();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const v = result.shift.variance;
    return (
      <Modal open={open} onClose={onClosed} size="md" title="Shift Ditutup" dismissable>
        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Kas Seharusnya</p>
              <p className="font-mono font-bold">{money(result.shift.expected_cash)}</p>
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs text-slate-500">Kas Dihitung</p>
              <p className="font-mono font-bold">{money(result.shift.counted_cash)}</p>
            </div>
            <div className={cx('rounded-lg p-3', v === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700')}>
              <p className="text-xs">Selisih</p>
              <p className="font-mono font-bold">{money(v)}</p>
            </div>
          </div>
          <p className="text-slate-600">
            {result.sales.trx_count} transaksi, penjualan bersih {rp(result.sales.sales_total)}. Laporan Z sudah dikirim ke printer.
          </p>
          <div className="flex justify-end gap-2">
            <button className="btn btn-secondary" onClick={() => print(<ShiftReport summary={result} settings={settings} />)}>
              <Printer className="size-4" /> Cetak Ulang
            </button>
            <button className="btn btn-primary" onClick={onClosed} autoFocus>
              Selesai
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <>
      <Modal
        open={open && !approveOpen}
        onClose={onClose}
        dismissable={!forced}
        size="lg"
        title={ownerName ? `Tutup Shift ${ownerName}` : forced ? 'Jam Shift Berakhir — Hitung Kas' : 'Tutup Shift — Hitung Kas'}
        subtitle={
          forced
            ? 'Hitung fisik uang di laci per pecahan untuk serah terima ke kasir berikutnya.'
            : 'Hitung fisik uang di laci per pecahan. Sistem tidak menampilkan saldo seharusnya (blind count).'
        }
        footer={
          <>
            {!forced && (
              <button className="btn btn-secondary" onClick={onClose}>
                Batal
              </button>
            )}
            <button className="btn btn-danger" onClick={submit} disabled={busy}>
              {busy && <Spinner />} {requireApproval ? 'Lanjut Otorisasi Supervisor' : 'Tutup Shift & Cetak Laporan Z'}
            </button>
          </>
        }
      >
        <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {CASH_DENOMINATIONS.map((d, i) => (
            <div key={d} className="flex items-center gap-3">
              <span className="flex w-28 items-center gap-2 font-mono text-sm font-semibold">
                <Banknote className={cx('size-4', d >= 1000 ? 'text-emerald-600' : 'text-amber-600')} />
                {money(d)}
              </span>
              <span className="text-slate-400">×</span>
              <NumberInput value={counts[d] ?? 0} onChange={(v) => setCounts({ ...counts, [d]: Math.floor(v) })} className="w-20" autoFocus={i === 0} />
              <span className="ml-auto font-mono text-sm text-slate-600">{money(d * (counts[d] ?? 0))}</span>
            </div>
          ))}
        </div>
        <div className="mt-5 flex items-center justify-between rounded-xl bg-slate-900 px-5 py-4 text-white">
          <span className="text-sm text-slate-300">Total kas dihitung</span>
          <span className="font-mono text-2xl font-bold">{rp(total)}</span>
        </div>
        <Field label="Catatan (opsional)" className="mt-4">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
        </Field>
        {error && <p className="mt-3 text-sm text-rose-600">{error}</p>}
      </Modal>
      <SupervisorDialog open={approveOpen} onClose={() => setApproveOpen(false)} onSubmit={close} description={`Tutup shift ${ownerName ?? ''} · kas dihitung ${rp(total)}`} />
    </>
  );
}

// ---------------------------------------------------------------- Kunci layar (pengganti logout saat shift berjalan)
export function LockScreen({ open, name, terminalCode, onUnlock }: { open: boolean; name: string; terminalCode: string; onUnlock: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) (setPassword(''), setError(null));
  }, [open]);
  if (!open) return null;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post('/auth/verify-password', { password });
      onUnlock();
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/95 p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4 text-center text-white">
        <Lock className="mx-auto size-10 text-slate-400" />
        <div>
          <p className="text-lg font-semibold">Layar terkunci</p>
          <p className="text-sm text-slate-400">
            {terminalCode} · {name}
          </p>
        </div>
        <input
          type="password"
          className="input py-3 text-center"
          placeholder="Password Anda"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          autoComplete="current-password"
        />
        {error && <p className="text-sm text-rose-400">{error}</p>}
        <button className="btn btn-primary w-full" disabled={busy || !password}>
          {busy && <Spinner />} Buka Kunci
        </button>
      </form>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------- Struk setelah transaksi
export function ReceiptDialog({ open, sale, settings, onClose }: { open: boolean; sale: any; settings: ReceiptSettings; onClose: () => void }) {
  const print = usePrint();
  if (!sale) return null;
  return (
    <Modal open={open} onClose={onClose} size="lg" bodyClassName="p-0">
      <div className="grid md:grid-cols-2">
        <div className="flex flex-col justify-between bg-emerald-600 p-8 text-white md:rounded-l-2xl">
          <div>
            <p className="text-sm font-semibold tracking-wide text-emerald-100 uppercase">Transaksi Berhasil</p>
            <p className="mt-1 font-mono text-sm text-emerald-100">{sale.receipt_no}</p>
          </div>
          <div className="my-10">
            <p className="text-sm text-emerald-100">Kembalian</p>
            <p className="font-mono text-5xl font-extrabold">{money(sale.change_amount)}</p>
            <p className="mt-4 text-sm text-emerald-100">Total {rp(sale.total)}</p>
            {sale.discount_total > 0 && <p className="text-sm text-emerald-100">Pelanggan hemat {rp(sale.discount_total)}</p>}
            {sale.points_earned > 0 && <p className="text-sm text-emerald-100">+{sale.points_earned} poin member</p>}
          </div>
          <div className="space-y-2">
            <button className="btn btn-lg w-full bg-white text-emerald-700 hover:bg-emerald-50" onClick={() => print(<Receipt sale={sale} settings={settings} />)}>
              <Printer className="size-5" /> Cetak Struk
            </button>
            <button className="btn btn-lg w-full bg-emerald-800 text-white hover:bg-emerald-900" onClick={onClose} autoFocus>
              Transaksi Baru <Kbd className="text-white">Enter</Kbd>
            </button>
          </div>
        </div>
        <div className="max-h-[80vh] overflow-y-auto bg-slate-100 p-6">
          <div className="mx-auto w-fit shadow-md">
            <Receipt sale={sale} settings={settings} />
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Menu & bantuan
export function MenuDialog({ open, onClose, actions }: { open: boolean; onClose: () => void; actions: { key: string; label: string; desc: string; icon: LucideIcon; onClick: () => void; danger?: boolean; hidden?: boolean }[] }) {
  const visible = actions.filter((a) => !a.hidden);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const a = visible.find((x) => x.key === e.key);
      if (a) {
        e.preventDefault();
        a.onClick();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, visible]);
  return (
    <Modal open={open} onClose={onClose} size="lg" title="Menu Kasir" subtitle="Tekan angka untuk memilih.">
      <div className="grid gap-2 sm:grid-cols-2">
        {visible.map((a) => (
          <button key={a.key} onClick={a.onClick} className={cx('flex items-start gap-3 rounded-xl border p-3.5 text-left transition hover:shadow-sm', a.danger ? 'border-rose-200 hover:bg-rose-50' : 'border-slate-200 hover:border-brand-300 hover:bg-brand-50')}>
            <span className={cx('grid size-9 shrink-0 place-items-center rounded-lg', a.danger ? 'bg-rose-100 text-rose-600' : 'bg-brand-100 text-brand-700')}>
              <a.icon className="size-4" />
            </span>
            <span className="flex-1">
              <span className="block text-sm font-semibold text-slate-900">{a.label}</span>
              <span className="block text-xs text-slate-500">{a.desc}</span>
            </span>
            <Kbd className="text-slate-500">{a.key}</Kbd>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const keys: [string, string][] = [
    ['Scan / Enter', 'Tambah barang dari barcode, SKU, atau PLU'],
    ['Ketik nama', 'Saran barang muncul langsung; ↑ ↓ lalu Enter'],
    ['3*kode', 'Scan dengan jumlah 3 (atau ketik 3* lalu scan)'],
    ['+', 'Tambah 1 qty barang terpilih'],
    ['F2', 'Cari barang (daftar lengkap)'],
    ['F3', 'Ubah jumlah barang terpilih'],
    ['F4', 'Member (scan kartu / no. HP)'],
    ['F5', 'Riwayat transaksi, cetak ulang, void, retur'],
    ['F6', 'Tunda transaksi'],
    ['F7', 'Panggil transaksi tertunda'],
    ['F8 / Del', 'Hapus barang terpilih (otorisasi)'],
    ['F9', 'Batalkan transaksi (otorisasi)'],
    ['F10', 'Pembayaran'],
    ['F12', 'Menu kasir (kas, laporan X, kunci layar, tutup shift)'],
    ['↑ / ↓', 'Pilih baris barang'],
    ['Esc', 'Tutup jendela / hapus ketikan'],
  ];
  return (
    <Modal open={open} onClose={onClose} size="md" title="Pintasan Keyboard">
      <dl className="divide-y divide-slate-100">
        {keys.map(([k, d]) => (
          <div key={k} className="flex items-center justify-between py-2 text-sm">
            <dt className="text-slate-600">{d}</dt>
            <dd>
              <Kbd className="px-2 py-0.5 text-xs text-slate-700">{k}</Kbd>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        Barang timbang: scan label timbangan (prefix 20–29) — berat terbaca otomatis. Untuk input manual, cari barang lalu isi berat dalam kg.
      </p>
      <p className="mt-2 rounded-lg bg-slate-50 p-3 text-xs text-slate-500">
        Tanpa alat scanner: tombol <b>Kamera</b> di samping kolom scan memakai webcam atau kamera HP. Kamera tetap terbuka untuk scan beruntun sampai menekan Selesai.
      </p>
    </Modal>
  );
}
