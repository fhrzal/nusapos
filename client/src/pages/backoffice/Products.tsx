import { Download, Package, Pencil, Plus, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { CameraButton } from '../../components/CameraScanner';
import { useFeedback } from '../../components/Feedback';
import { Barcode } from '../../components/Print';
import { NumberInput } from '../../components/shared';
import { Badge, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Pagination, SearchInput, Spinner, Toggle } from '../../components/ui';
import { get, post, put, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { downloadCsv, fmtDateTime, money, num, pct, qty as fmtQty, rp } from '../../lib/format';
import { useDebounced, useFetch } from '../../lib/hooks';

const EMPTY = {
  sku: '',
  barcode: '',
  plu_code: '',
  name: '',
  short_name: '',
  brand: '',
  category_id: null as number | null,
  supplier_id: null as number | null,
  unit: 'PCS',
  cost_price: 0,
  sell_price: 0,
  tax_type: 'PPN' as 'PPN' | 'NON_PPN',
  is_weighted: false,
  min_stock: 0,
  is_active: true,
};

/** Margin atas harga jual sebelum PPN. */
function marginPct(sellPrice: number, cost: number, taxType: string, taxRate = 11) {
  const net = taxType === 'PPN' ? sellPrice / (1 + taxRate / 100) : sellPrice;
  return net ? ((net - cost) / net) * 100 : 0;
}

function ProductForm({ product, onClose, onSaved }: { product: any | null; onClose: () => void; onSaved: () => void }) {
  const { data: categories } = useFetch<any[]>('/categories');
  const { data: suppliers } = useFetch<any[]>('/suppliers');
  const { toast } = useFeedback();
  const [f, setF] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isNew = product && !product.id;

  useEffect(() => {
    if (!product) return;
    setError(null);
    setF(
      product.id
        ? {
            ...EMPTY,
            ...product,
            barcode: product.barcode ?? '',
            plu_code: product.plu_code ?? '',
            short_name: product.short_name ?? '',
            brand: product.brand ?? '',
            is_weighted: !!product.is_weighted,
            is_active: !!product.is_active,
          }
        : EMPTY,
    );
  }, [product]);

  const { data: settings } = useFetch<any>('/settings');
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setF((x) => ({ ...x, [k]: v }));
  const margin = marginPct(f.sell_price, f.cost_price, f.tax_type, settings?.tax_rate);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { ...f, min_stock: Number(f.min_stock) };
      if (isNew) await post('/products', body);
      else await put(`/products/${product.id}`, body);
      toast(isNew ? 'Produk ditambahkan' : 'Produk diperbarui');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!product}
      onClose={onClose}
      size="xl"
      title={isNew ? 'Tambah Produk' : `Ubah Produk — ${product?.sku}`}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button form="product-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner />} Simpan
          </button>
        </>
      }
    >
      <form id="product-form" onSubmit={save} className="grid gap-4 md:grid-cols-3">
        <Field label="SKU / Kode Barang">
          <input className="input font-mono uppercase" value={f.sku} onChange={(e) => set('sku', e.target.value.toUpperCase())} required />
        </Field>
        <Field label="Barcode (EAN)" hint="Kosongkan untuk barang timbang">
          <div className="flex gap-2">
            <input className="input font-mono" value={f.barcode} onChange={(e) => set('barcode', e.target.value.replace(/\D/g, ''))} maxLength={14} />
            <CameraButton
              title="Scan Barcode Produk"
              onDetected={(code) => {
                if (!/^\d{8,14}$/.test(code)) throw new Error('Barcode produk harus 8–14 digit angka (EAN/UPC)');
                set('barcode', code);
                return code;
              }}
            />
          </div>
        </Field>
        <Field label="Merek">
          <input className="input" value={f.brand} onChange={(e) => set('brand', e.target.value)} />
        </Field>
        <Field label="Nama Produk" className="md:col-span-2">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Nama di Struk" hint="Maks. 24 karakter">
          <input className="input" value={f.short_name} onChange={(e) => set('short_name', e.target.value)} maxLength={24} />
        </Field>
        <Field label="Kategori">
          <select className="input" value={f.category_id ?? ''} onChange={(e) => set('category_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Pilih —</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Supplier Utama">
          <select className="input" value={f.supplier_id ?? ''} onChange={(e) => set('supplier_id', e.target.value ? Number(e.target.value) : null)}>
            <option value="">— Pilih —</option>
            {suppliers?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Satuan">
          <input className="input uppercase" value={f.unit} onChange={(e) => set('unit', e.target.value.toUpperCase())} maxLength={10} required />
        </Field>
        <Field label="Harga Beli (HPP)" hint="Diperbarui otomatis (rata-rata bergerak) saat penerimaan barang">
          <NumberInput value={f.cost_price} onChange={(v) => set('cost_price', v)} />
        </Field>
        <Field label="Harga Jual (termasuk PPN)" hint={<span className={cx(margin < 5 ? 'text-rose-600' : 'text-emerald-600')}>Margin {pct(margin)}</span>}>
          <NumberInput value={f.sell_price} onChange={(v) => set('sell_price', v)} />
        </Field>
        <Field label="Status Pajak">
          <select className="input" value={f.tax_type} onChange={(e) => set('tax_type', e.target.value as 'PPN')}>
            <option value="PPN">BKP — dikenakan PPN</option>
            <option value="NON_PPN">Non-PPN (kebutuhan pokok)</option>
          </select>
        </Field>
        <Field label="Stok Minimum (per toko)" hint="Batas peringatan & saran order">
          <NumberInput value={f.min_stock} onChange={(v) => set('min_stock', v)} decimals={3} />
        </Field>
        <div className="space-y-3 md:col-span-2">
          <Toggle checked={f.is_weighted} onChange={(v) => set('is_weighted', v)} label="Barang timbang (dijual per kg)" description="Dapat dibaca dari label timbangan dengan kode PLU." />
          {f.is_weighted && (
            <Field label="Kode PLU Timbangan (5 digit)">
              <input className="input w-40 font-mono" value={f.plu_code} onChange={(e) => set('plu_code', e.target.value.replace(/\D/g, ''))} maxLength={5} />
            </Field>
          )}
          {!isNew && <Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Produk aktif" description="Produk nonaktif tidak dapat dijual di kasir." />}
        </div>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 md:col-span-3">{error}</p>}
      </form>
    </Modal>
  );
}

function ProductDetail({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (p: any) => void }) {
  const { storeId, can } = useAuth();
  const { data: p, error } = useFetch<any>(id ? `/products/${id}` : null, { store_id: storeId });
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={p?.name ?? 'Detail Produk'}
      subtitle={p && `${p.sku} · ${p.category_name ?? '-'} · ${p.supplier_name ?? '-'}`}
      footer={
        p &&
        can('products.manage') && (
          <button className="btn btn-primary" onClick={() => onEdit(p)}>
            <Pencil className="size-4" /> Ubah
          </button>
        )
      }
    >
      {error && <ErrorBox message={error} />}
      {!p ? (
        <Loading />
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Harga Jual', rp(p.sell_price)],
              ['HPP', rp(p.cost_price)],
              ['Terjual 30 hari', `${fmtQty(p.sales30d.qty)} ${p.unit}`],
              ['Omzet 30 hari', rp(p.sales30d.revenue)],
            ].map(([l, v]) => (
              <div key={l} className="rounded-lg bg-slate-50 p-3">
                <p className="text-xs text-slate-500">{l}</p>
                <p className="font-semibold">{v}</p>
              </div>
            ))}
          </div>
          {p.barcode && (
            <div className="flex justify-center rounded-lg border border-slate-200 p-4">
              <Barcode value={p.barcode} height={50} width={1.8} fontSize={13} />
            </div>
          )}
          {p.promos.length > 0 && (
            <div>
              <p className="label">Promo berjalan</p>
              <div className="flex flex-wrap gap-2">
                {p.promos.map((pr: any) => (
                  <Badge key={pr.id} tone="green">
                    {pr.name} · s.d. {pr.endDate}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          <div>
            <p className="label">Stok per toko</p>
            <table className="tbl rounded-lg border border-slate-200">
              <thead>
                <tr>
                  <th>Toko</th>
                  <th className="num">Stok</th>
                  <th>Pembaruan Terakhir</th>
                </tr>
              </thead>
              <tbody>
                {p.stocks.map((s: any) => (
                  <tr key={s.store_id}>
                    <td>
                      {s.code} — {s.name}
                    </td>
                    <td className={cx('num font-semibold', s.qty <= p.min_stock && 'text-rose-600')}>
                      {fmtQty(s.qty, p.is_weighted)} {p.unit}
                    </td>
                    <td className="text-slate-500">{fmtDateTime(s.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Modal>
  );
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const sep = text.split('\n')[0].includes(';') ? ';' : ',';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === sep) row.push(cell), (cell = '');
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  const [header, ...body] = rows;
  const keys = header.map((h) => h.trim().toLowerCase().replace(/^﻿/, ''));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export default function Products() {
  const { storeId, can } = useAuth();
  const { toast } = useFeedback();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('active');
  const [lowStock, setLowStock] = useState(false);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dq = useDebounced(q);
  const { data: categories } = useFetch<any[]>('/categories');
  const { data: settings } = useFetch<any>('/settings');
  const query = { q: dq, category_id: category, status, low_stock: lowStock ? 1 : '', store_id: storeId, page, limit: 30 };
  const { data, error, loading, reload } = useFetch<Paged<any>>('/products', query);

  const exportCsv = async () => {
    const all = await get<Paged<any>>('/products', { ...query, page: 1, limit: 500 });
    downloadCsv('produk.csv', [
      ['sku', 'barcode', 'name', 'category_code', 'unit', 'cost_price', 'sell_price', 'tax_type', 'min_stock', 'stock'],
      ...all.data.map((p) => [p.sku, p.barcode, p.name, categories?.find((c) => c.id === p.category_id)?.code, p.unit, p.cost_price, p.sell_price, p.tax_type, p.min_stock, p.stock]),
    ]);
  };

  const importCsv = async (file: File) => {
    setImporting(true);
    try {
      const rows = parseCsv(await file.text());
      const r = await post<{ created: number; updated: number }>('/products/import', { rows });
      toast(`Impor selesai: ${r.created} produk baru, ${r.updated} diperbarui`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div>
      <PageHeader
        title="Master Produk"
        description="Katalog barang, harga jual, HPP, dan stok."
        actions={
          <>
            <button className="btn btn-secondary" onClick={exportCsv}>
              <Download className="size-4" /> Ekspor
            </button>
            {can('products.manage') && (
              <>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && importCsv(e.target.files[0])} />
                <button className="btn btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing} title="Kolom: sku, barcode, name, category_code, unit, cost_price, sell_price, tax_type, min_stock">
                  {importing ? <Spinner /> : <Upload className="size-4" />} Impor CSV
                </button>
                <button className="btn btn-primary" onClick={() => setEditing({})}>
                  <Plus className="size-4" /> Tambah Produk
                </button>
              </>
            )}
          </>
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 p-4">
          <SearchInput className="min-w-64 flex-1" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Cari nama, merek, SKU, barcode, PLU…" />
          <select className="input w-auto" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))}>
            <option value="">Semua kategori</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <select className="input w-auto" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
            <option value="active">Aktif</option>
            <option value="inactive">Nonaktif</option>
            <option value="all">Semua status</option>
          </select>
          <Toggle checked={lowStock} onChange={(v) => (setLowStock(v), setPage(1))} label="Stok menipis" />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="tbl tbl-hover">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Nama Produk</th>
                    <th>Kategori</th>
                    <th className="num">HPP</th>
                    <th className="num">Harga Jual</th>
                    <th className="num">Margin</th>
                    <th className="num">Stok {storeId ? '' : '(semua toko)'}</th>
                    <th>Status</th>
                    {can('products.manage') && <th />}
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((p) => {
                    const m = marginPct(p.sell_price, p.cost_price, p.tax_type, settings?.tax_rate);
                    return (
                      <tr key={p.id} onClick={() => setDetail(p.id)}>
                        <td className="font-mono text-xs">
                          <p className="font-semibold">{p.sku}</p>
                          <p className="text-slate-500">{p.barcode ?? (p.plu_code ? `PLU ${p.plu_code}` : '—')}</p>
                        </td>
                        <td>
                          <p className="font-medium text-slate-900">{p.name}</p>
                          <p className="text-xs text-slate-500">
                            {p.brand} · {p.unit}
                            {p.is_weighted ? ' · Timbang' : ''}
                            {p.tax_type === 'NON_PPN' ? ' · Non-PPN' : ''}
                          </p>
                        </td>
                        <td className="text-slate-600">{p.category_name}</td>
                        <td className="num text-slate-600">{money(p.cost_price)}</td>
                        <td className="num font-semibold">{money(p.sell_price)}</td>
                        <td className={cx('num', m < 5 ? 'text-rose-600' : 'text-slate-600')}>{pct(m)}</td>
                        <td className={cx('num font-semibold', p.stock <= (storeId ? p.min_stock : 0) && 'text-rose-600')}>{fmtQty(p.stock, p.is_weighted)}</td>
                        <td>{p.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                        {can('products.manage') && (
                          <td>
                            <button className="btn btn-sm btn-ghost" onClick={(e) => (e.stopPropagation(), setEditing(p))} aria-label="Ubah">
                              <Pencil className="size-4" />
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={30} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={Package} title="Produk tidak ditemukan" description={`Total ${num(data?.total)} produk.`} />
        )}
      </div>
      <ProductForm product={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <ProductDetail id={detail} onClose={() => setDetail(null)} onEdit={(p) => (setDetail(null), setEditing(p))} />
    </div>
  );
}
