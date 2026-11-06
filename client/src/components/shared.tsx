import { Package, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, get, type Paged } from '../lib/api';
import { useAuth } from '../lib/auth';
import { money, num, parseNumber, qty as fmtQty } from '../lib/format';
import { useDebounced } from '../lib/hooks';
import { CameraButton } from './CameraScanner';
import { Badge, cx, Field, Modal, Spinner } from './ui';

export interface ProductLite {
  id: number;
  sku: string;
  barcode: string | null;
  plu_code?: string | null;
  name: string;
  brand?: string | null;
  unit: string;
  sell_price: number;
  cost_price?: number;
  category_id: number | null;
  category_name?: string;
  tax_type: 'PPN' | 'NON_PPN';
  is_weighted: number;
  stock: number;
  min_stock: number;
  supplier_id?: number | null;
}

// ---------------------------------------------------------------- Otorisasi supervisor
export interface Approval {
  username: string;
  pin: string;
}

export function SupervisorDialog({
  open,
  title = 'Otorisasi Supervisor',
  description,
  onClose,
  onSubmit,
  children,
}: {
  open: boolean;
  title?: string;
  description?: ReactNode;
  onClose: () => void;
  /** Lempar error untuk menampilkan pesan dan menahan dialog tetap terbuka. */
  onSubmit: (approval: Approval) => Promise<void>;
  children?: ReactNode;
}) {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setPin('');
      setError(null);
    }
  }, [open]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ username: username.trim(), pin });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="sm">
      <form onSubmit={submit} className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-amber-100 p-2.5 text-amber-700">
            <ShieldCheck className="size-5" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">{title}</h2>
            {description && <div className="text-sm text-slate-500">{description}</div>}
          </div>
        </div>
        {children}
        <Field label="Username supervisor">
          <input className="input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!username} autoComplete="off" required />
        </Field>
        <Field label="PIN">
          <input
            className="input text-center font-mono text-lg tracking-[0.5em]"
            type="password"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            autoFocus={!!username}
            required
          />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={busy || pin.length < 4 || !username}>
            {busy && <Spinner />} Otorisasi
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- Pencarian produk
/**
 * Cari di katalog lokal: semua kata harus cocok dengan nama/merek/kategori/kode.
 * Urutan: kode persis → awalan kode → awalan nama → lainnya.
 */
export function searchCatalog(list: ProductLite[], query: string, limit = 50): ProductLite[] {
  const q = query.trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  const words = q.split(/\s+/);
  const scored: [number, ProductLite][] = [];
  for (const p of list) {
    const name = p.name.toLowerCase();
    const codes = [p.sku, p.barcode, p.plu_code].filter(Boolean).map((c) => c!.toLowerCase());
    const hay = `${name} ${(p.brand ?? '').toLowerCase()} ${(p.category_name ?? '').toLowerCase()} ${codes.join(' ')}`;
    if (!words.every((w) => hay.includes(w))) continue;
    const score = codes.includes(q) ? 0 : codes.some((c) => c.startsWith(q)) ? 1 : name.startsWith(q) ? 2 : 3;
    scored.push([score, p]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].name.localeCompare(b[1].name))
    .slice(0, limit)
    .map(([, p]) => p);
}

export function ProductSearchDialog({
  open,
  onClose,
  onSelect,
  storeId,
  initialQuery = '',
  catalog,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (p: ProductLite) => void;
  storeId: number | null;
  initialQuery?: string;
  /** Jika diisi, pencarian dilakukan di katalog lokal (instan, tanpa request). */
  catalog?: ProductLite[];
}) {
  const [q, setQ] = useState(initialQuery);
  const dq = useDebounced(q, catalog ? 0 : 200);
  const [rows, setRows] = useState<ProductLite[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) setQ(initialQuery);
  }, [open, initialQuery]);

  useEffect(() => {
    if (!open) return;
    if (catalog) {
      setRows(searchCatalog(catalog, dq));
      setActive(0);
      return;
    }
    let alive = true;
    setLoading(true);
    get<Paged<ProductLite>>('/products', { q: dq, limit: 40, store_id: storeId })
      .then((r) => alive && (setRows(r.data), setActive(0)))
      .catch(() => alive && setRows([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [dq, open, storeId, catalog]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (p?: ProductLite) => {
    if (!p) return;
    onSelect(p);
    onClose();
  };

  return (
    <Modal open={open} onClose={onClose} size="xl" title="Cari Barang" subtitle="Ketik nama, merek, SKU, atau barcode. Gunakan ↑ ↓ lalu Enter.">
      <div className="space-y-3">
        <div className="relative">
          <input
            className="input py-3 text-base"
            placeholder="Contoh: indomie, aqua, MIE0001…"
            value={q}
            autoFocus
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(rows.length - 1, a + 1)));
              if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
              if (e.key === 'Enter') (e.preventDefault(), choose(rows[active]));
            }}
          />
          {loading && <Spinner className="absolute top-1/2 right-3 size-4 -translate-y-1/2 text-slate-400" />}
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto rounded-lg border border-slate-200">
          <table className="tbl">
            <thead>
              <tr>
                <th>SKU / Barcode</th>
                <th>Nama Barang</th>
                <th className="num">Harga</th>
                <th className="num">Stok</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p, i) => (
                <tr
                  key={p.id}
                  data-idx={i}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(p)}
                  className={cx('cursor-pointer', i === active ? 'bg-brand-50' : 'hover:bg-slate-50')}
                >
                  <td className="font-mono text-xs text-slate-500">
                    {p.sku}
                    <div>{p.barcode ?? (p.is_weighted ? 'Timbang' : '—')}</div>
                  </td>
                  <td>
                    <div className="font-medium text-slate-900">{p.name}</div>
                    <div className="text-xs text-slate-500">
                      {p.category_name} · {p.unit}
                      {p.tax_type === 'NON_PPN' && ' · Non-PPN'}
                    </div>
                  </td>
                  <td className="num font-semibold">{money(p.sell_price)}</td>
                  <td className={cx('num', p.stock <= p.min_stock ? 'font-semibold text-rose-600' : 'text-slate-600')}>{fmtQty(p.stock, p.is_weighted)}</td>
                </tr>
              ))}
              {!rows.length && !loading && (
                <tr>
                  <td colSpan={4} className="py-10 text-center text-slate-500">
                    Barang tidak ditemukan
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- Editor baris barang (dokumen stok)
export interface ItemLine {
  product: ProductLite;
  qty: number;
  cost_price?: number;
}

/** Input cepat: ketik/scan kode lalu Enter, atau tekan tombol cari. */
export function ProductQuickAdd({
  storeId,
  onAdd,
  placeholder = 'Scan barcode / ketik SKU lalu Enter…',
  multiple = true,
}: {
  storeId: number | null;
  onAdd: (p: ProductLite) => void;
  placeholder?: string;
  /** Kamera tetap terbuka untuk scan beberapa barang sekaligus. */
  multiple?: boolean;
}) {
  const [code, setCode] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lookup = async () => {
    if (!code.trim()) return setSearchOpen(true);
    try {
      const r = await get<{ product: ProductLite }>('/products/lookup', { code: code.trim(), store_id: storeId });
      onAdd(r.product);
      setCode('');
      setError(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setSearchOpen(true);
      else setError((e as Error).message);
    }
  };
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Package className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
          <input
            className="input pl-9"
            value={code}
            placeholder={placeholder}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), lookup())}
          />
        </div>
        <CameraButton
          multiple={multiple}
          onDetected={async (c) => {
            const r = await get<{ product: ProductLite }>('/products/lookup', { code: c, store_id: storeId });
            onAdd(r.product);
            setError(null);
            return r.product.name;
          }}
        />
        <button type="button" className="btn btn-secondary" onClick={() => setSearchOpen(true)}>
          Cari Barang
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-rose-600">{error}</p>}
      <ProductSearchDialog open={searchOpen} onClose={() => setSearchOpen(false)} onSelect={(p) => (onAdd(p), setCode(''))} storeId={storeId} initialQuery={code} />
    </div>
  );
}

export function ItemLinesEditor({
  lines,
  onChange,
  storeId,
  withCost,
  qtyLabel = 'Qty',
  showStock = true,
  extraColumn,
}: {
  lines: ItemLine[];
  onChange: (l: ItemLine[]) => void;
  storeId: number | null;
  withCost?: boolean;
  qtyLabel?: string;
  showStock?: boolean;
  extraColumn?: { header: string; render: (l: ItemLine) => ReactNode };
}) {
  const add = (p: ProductLite) => {
    const idx = lines.findIndex((l) => l.product.id === p.id);
    if (idx >= 0) onChange(lines.map((l, i) => (i === idx ? { ...l, qty: l.qty + 1 } : l)));
    else onChange([...lines, { product: p, qty: 1, cost_price: p.cost_price }]);
  };
  const update = (i: number, patch: Partial<ItemLine>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const total = lines.reduce((s, l) => s + l.qty * (l.cost_price ?? 0), 0);

  return (
    <div className="space-y-3">
      <ProductQuickAdd storeId={storeId} onAdd={add} />
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="tbl">
          <thead>
            <tr>
              <th>Barang</th>
              {showStock && <th className="num">Stok Sistem</th>}
              {extraColumn && <th className="num">{extraColumn.header}</th>}
              <th className="num w-32">{qtyLabel}</th>
              {withCost && <th className="num w-36">Harga Beli</th>}
              {withCost && <th className="num">Subtotal</th>}
              <th className="w-10" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={l.product.id}>
                <td>
                  <div className="font-medium text-slate-900">{l.product.name}</div>
                  <div className="font-mono text-xs text-slate-500">
                    {l.product.sku} · {l.product.unit}
                  </div>
                </td>
                {showStock && <td className="num text-slate-600">{fmtQty(l.product.stock, l.product.is_weighted)}</td>}
                {extraColumn && <td className="num">{extraColumn.render(l)}</td>}
                <td>
                  <NumberInput value={l.qty} onChange={(v) => update(i, { qty: v })} decimals={l.product.is_weighted ? 3 : 0} allowNegative={qtyLabel.includes('±')} />
                </td>
                {withCost && (
                  <td>
                    <NumberInput value={l.cost_price ?? 0} onChange={(v) => update(i, { cost_price: v })} />
                  </td>
                )}
                {withCost && <td className="num font-medium">{money(l.qty * (l.cost_price ?? 0))}</td>}
                <td>
                  <button type="button" className="rounded p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Hapus">
                    <Trash2 className="size-4" />
                  </button>
                </td>
              </tr>
            ))}
            {!lines.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-sm text-slate-500">
                  Belum ada barang. Scan barcode atau cari barang di atas.
                </td>
              </tr>
            )}
          </tbody>
          {withCost && lines.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={showStock ? 4 : 3}>
                  Total ({lines.length} SKU, {num(lines.reduce((s, l) => s + l.qty, 0), 3)} unit)
                </td>
                <td className="num">{money(total)}</td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function NumberInput({
  value,
  onChange,
  decimals = 0,
  allowNegative,
  className,
  ...rest
}: {
  value: number;
  onChange: (v: number) => void;
  decimals?: number;
  allowNegative?: boolean;
  className?: string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const [text, setText] = useState(String(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value.toLocaleString('id-ID', { maximumFractionDigits: decimals }));
  }, [value, focused, decimals]);
  return (
    <input
      {...rest}
      className={cx('input text-right tabular-nums', className)}
      inputMode="decimal"
      value={text}
      onFocus={(e) => {
        setFocused(true);
        setText(String(value).replace('.', ','));
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => setFocused(false)}
      onChange={(e) => {
        setText(e.target.value);
        const n = parseNumber(e.target.value);
        if (Number.isFinite(n) && (allowNegative || n >= 0)) onChange(Number(n.toFixed(decimals)));
      }}
    />
  );
}

/** Pilihan toko untuk form dokumen. User toko otomatis dikunci ke tokonya. */
export function StoreSelect({ value, onChange, label = 'Toko', includeAll, exclude }: { value: number | null; onChange: (id: number | null) => void; label?: string; includeAll?: boolean; exclude?: number | null }) {
  const { stores, user } = useAuth();
  return (
    <Field label={label}>
      <select className="input" value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} disabled={!!user?.store_id && !exclude}>
        {(includeAll || value === null) && <option value="">{includeAll ? 'Semua toko' : '— Pilih toko —'}</option>}
        {stores
          .filter((s) => s.id !== exclude)
          .map((s) => (
            <option key={s.id} value={s.id}>
              {s.code} — {s.name}
            </option>
          ))}
      </select>
    </Field>
  );
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'violet']> = {
    COMPLETED: ['Selesai', 'green'],
    VOIDED: ['Void', 'red'],
    OPEN: ['Berjalan', 'green'],
    CLOSED: ['Ditutup', 'gray'],
    DRAFT: ['Draft', 'gray'],
    APPROVED: ['Disetujui', 'blue'],
    PARTIAL: ['Diterima Sebagian', 'amber'],
    RECEIVED: ['Diterima', 'green'],
    CANCELLED: ['Dibatalkan', 'red'],
    IN_TRANSIT: ['Dalam Perjalanan', 'amber'],
  };
  const [label, tone] = map[status] ?? [status, 'gray'];
  return <Badge tone={tone}>{label}</Badge>;
}
