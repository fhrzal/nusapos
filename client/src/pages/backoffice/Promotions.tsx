import { PROMO_TYPE_LABELS, type PromoType } from '@shared/types';
import { BadgePercent, CalendarDays, Pencil, Plus, Power, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { NumberInput, ProductQuickAdd, StoreSelect } from '../../components/shared';
import { Badge, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Spinner, Tabs, Toggle } from '../../components/ui';
import { get, post, put } from '../../lib/api';
import { daysAgo, fmtDate, isoDate, money, num, rp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

type Status = 'all' | 'running' | 'scheduled' | 'ended';

function describe(p: any): string {
  switch (p.type as PromoType) {
    case 'PERCENT':
      return `Diskon ${p.value}%`;
    case 'AMOUNT':
      return `Potong ${rp(p.value)}/unit`;
    case 'SPECIAL_PRICE':
      return `Harga jadi ${rp(p.value)}`;
    case 'BUY_X_GET_Y':
      return `Beli ${p.buy_qty} gratis ${p.get_qty}`;
    case 'BUNDLE_PRICE':
      return `${p.buy_qty} pcs ${rp(p.value)}`;
  }
}

function promoState(p: any) {
  const today = isoDate();
  if (!p.is_active) return <Badge>Nonaktif</Badge>;
  if (p.end_date < today) return <Badge>Berakhir</Badge>;
  if (p.start_date > today) return <Badge tone="blue">Terjadwal</Badge>;
  return <Badge tone="green">Berjalan</Badge>;
}

const BLANK = {
  code: '',
  name: '',
  description: '',
  type: 'PERCENT' as PromoType,
  value: 10,
  buy_qty: 2,
  get_qty: 1,
  min_qty: 1,
  scope: 'PRODUCT' as 'PRODUCT' | 'CATEGORY',
  targets: [] as { id: number; name: string; sku?: string; sell_price?: number }[],
  member_only: false,
  store_id: null as number | null,
  start_date: isoDate(),
  end_date: daysAgo(-14),
  is_active: true,
};

function PromoForm({ promoId, open, onClose, onSaved }: { promoId: number | null; open: boolean; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const { data: categories } = useFetch<any[]>('/categories');
  const [f, setF] = useState(BLANK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (!promoId) return setF(BLANK);
    get(`/promotions/${promoId}`).then((p) =>
      setF({
        ...BLANK,
        ...p,
        description: p.description ?? '',
        buy_qty: p.buy_qty ?? 2,
        get_qty: p.get_qty ?? 1,
        member_only: !!p.member_only,
        is_active: !!p.is_active,
        targets: p.targets,
      }),
    );
  }, [open, promoId]);

  const set = <K extends keyof typeof BLANK>(k: K, v: (typeof BLANK)[K]) => setF((x) => ({ ...x, [k]: v }));
  const toggleCategory = (c: any) =>
    set('targets', f.targets.some((t) => t.id === c.id) ? f.targets.filter((t) => t.id !== c.id) : [...f.targets, { id: c.id, name: c.name }]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { targets, ...rest } = f;
      const body = {
        ...rest,
        target_ids: targets.map((t) => t.id),
        buy_qty: f.type === 'BUY_X_GET_Y' || f.type === 'BUNDLE_PRICE' ? f.buy_qty : null,
        get_qty: f.type === 'BUY_X_GET_Y' ? f.get_qty : null,
      };
      if (promoId) await put(`/promotions/${promoId}`, body);
      else await post('/promotions', body);
      toast('Promo tersimpan');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={promoId ? 'Ubah Promo' : 'Buat Promo Baru'}
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button form="promo-form" className="btn btn-primary" disabled={busy}>
            {busy && <Spinner />} Simpan Promo
          </button>
        </>
      }
    >
      <form id="promo-form" onSubmit={save} className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <Field label="Kode">
              <input className="input font-mono uppercase" value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} required />
            </Field>
            <Field label="Nama Promo (tampil di struk)" className="col-span-2">
              <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} maxLength={60} required />
            </Field>
          </div>
          <Field label="Jenis Promo">
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(PROMO_TYPE_LABELS) as PromoType[]).map((t) => (
                <button type="button" key={t} onClick={() => set('type', t)} className={cx('rounded-lg border px-3 py-2 text-left text-sm font-medium', f.type === t ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-500/20' : 'border-slate-200 text-slate-700 hover:border-slate-300')}>
                  {PROMO_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {f.type === 'PERCENT' && (
              <Field label="Diskon (%)">
                <NumberInput value={f.value} onChange={(v) => set('value', v)} decimals={2} />
              </Field>
            )}
            {f.type === 'AMOUNT' && (
              <Field label="Potongan per unit (Rp)">
                <NumberInput value={f.value} onChange={(v) => set('value', v)} />
              </Field>
            )}
            {f.type === 'SPECIAL_PRICE' && (
              <Field label="Harga spesial (Rp)">
                <NumberInput value={f.value} onChange={(v) => set('value', v)} />
              </Field>
            )}
            {(f.type === 'BUY_X_GET_Y' || f.type === 'BUNDLE_PRICE') && (
              <Field label={f.type === 'BUY_X_GET_Y' ? 'Jumlah beli' : 'Jumlah per paket'}>
                <NumberInput value={f.buy_qty} onChange={(v) => set('buy_qty', v)} />
              </Field>
            )}
            {f.type === 'BUY_X_GET_Y' && (
              <Field label="Jumlah gratis">
                <NumberInput value={f.get_qty} onChange={(v) => set('get_qty', v)} />
              </Field>
            )}
            {f.type === 'BUNDLE_PRICE' && (
              <Field label="Harga paket (Rp)">
                <NumberInput value={f.value} onChange={(v) => set('value', v)} />
              </Field>
            )}
            <Field label="Minimal qty per item">
              <NumberInput value={f.min_qty} onChange={(v) => set('min_qty', v)} decimals={3} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mulai">
              <input type="date" className="input" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} required />
            </Field>
            <Field label="Selesai">
              <input type="date" className="input" value={f.end_date} onChange={(e) => set('end_date', e.target.value)} required />
            </Field>
          </div>
          <StoreSelect value={f.store_id} onChange={(v) => set('store_id', v)} label="Berlaku di toko" includeAll />
          <Toggle checked={f.member_only} onChange={(v) => set('member_only', v)} label="Khusus member" description="Hanya berlaku jika kartu member di-scan di kasir." />
          {promoId && <Toggle checked={f.is_active} onChange={(v) => set('is_active', v)} label="Promo aktif" />}
          <Field label="Keterangan internal">
            <textarea className="input" rows={2} value={f.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <div className="space-y-3">
          <Field label="Berlaku untuk">
            <div className="flex gap-2">
              {(['PRODUCT', 'CATEGORY'] as const).map((s) => (
                <button type="button" key={s} onClick={() => (set('scope', s), set('targets', []))} className={cx('btn flex-1', f.scope === s ? 'btn-primary' : 'btn-secondary')}>
                  {s === 'PRODUCT' ? 'Produk tertentu' : 'Kategori'}
                </button>
              ))}
            </div>
          </Field>
          {f.scope === 'PRODUCT' ? (
            <>
              <ProductQuickAdd storeId={null} onAdd={(p) => !f.targets.some((t) => t.id === p.id) && set('targets', [...f.targets, { id: p.id, name: p.name, sku: p.sku, sell_price: p.sell_price }])} />
              <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
                {f.targets.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="flex-1">
                      {t.name}
                      <span className="ml-2 font-mono text-xs text-slate-500">{t.sku}</span>
                    </span>
                    {t.sell_price !== undefined && <span className="font-mono text-xs text-slate-600">{money(t.sell_price)}</span>}
                    <button type="button" className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => set('targets', f.targets.filter((x) => x.id !== t.id))} aria-label="Hapus">
                      <X className="size-4" />
                    </button>
                  </li>
                ))}
                {!f.targets.length && <li className="px-3 py-6 text-center text-sm text-slate-500">Belum ada produk dipilih.</li>}
              </ul>
            </>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {categories?.map((c) => (
                <label key={c.id} className={cx('flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm', f.targets.some((t) => t.id === c.id) ? 'border-brand-400 bg-brand-50' : 'border-slate-200')}>
                  <input type="checkbox" checked={f.targets.some((t) => t.id === c.id)} onChange={() => toggleCategory(c)} className="accent-brand-600" />
                  {c.name}
                </label>
              ))}
            </div>
          )}
          <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
            Jika satu barang memenuhi beberapa promo, sistem otomatis memilih promo dengan potongan terbesar untuk pelanggan (promo tidak ditumpuk).
          </p>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        </div>
      </form>
    </Modal>
  );
}

export default function Promotions() {
  const { toast } = useFeedback();
  const [status, setStatus] = useState<Status>('running');
  const [editing, setEditing] = useState<{ id: number | null } | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>('/promotions', { status });

  const toggle = async (p: any) => {
    await post(`/promotions/${p.id}/toggle`);
    toast(p.is_active ? 'Promo dinonaktifkan' : 'Promo diaktifkan');
    reload();
  };

  return (
    <div>
      <PageHeader
        title="Promosi"
        description="Diskon, harga spesial, beli X gratis Y, dan harga paket — diterapkan otomatis di kasir."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({ id: null })}>
            <Plus className="size-4" /> Buat Promo
          </button>
        }
      />
      <div className="card">
        <div className="px-4 pt-2">
          <Tabs
            tabs={[
              { key: 'running', label: 'Berjalan' },
              { key: 'scheduled', label: 'Terjadwal' },
              { key: 'ended', label: 'Berakhir / Nonaktif' },
              { key: 'all', label: 'Semua' },
            ]}
            value={status}
            onChange={setStatus}
          />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Promo</th>
                  <th>Mekanisme</th>
                  <th>Cakupan</th>
                  <th>Periode</th>
                  <th className="num">Dipakai</th>
                  <th className="num">Total Potongan</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <p className="font-medium text-slate-900">{p.name}</p>
                      <p className="font-mono text-xs text-slate-500">{p.code}</p>
                    </td>
                    <td>
                      <p className="text-sm">{describe(p)}</p>
                      <div className="mt-0.5 flex gap-1">
                        <Badge tone="violet">{PROMO_TYPE_LABELS[p.type as PromoType]}</Badge>
                        {p.member_only ? <Badge tone="amber">Member</Badge> : null}
                      </div>
                    </td>
                    <td className="text-sm text-slate-600">
                      {num(p.target_count)} {p.scope === 'PRODUCT' ? 'produk' : 'kategori'}
                      <div className="text-xs">{p.store_code ? `Toko ${p.store_code}` : 'Semua toko'}</div>
                    </td>
                    <td className="text-sm whitespace-nowrap text-slate-600">
                      <CalendarDays className="mr-1 inline size-3.5" />
                      {fmtDate(p.start_date)} – {fmtDate(p.end_date)}
                    </td>
                    <td className="num">{num(p.usage_count)} trx</td>
                    <td className="num font-semibold text-emerald-700">{money(p.discount_given)}</td>
                    <td>{promoState(p)}</td>
                    <td className="whitespace-nowrap">
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: p.id })} aria-label="Ubah">
                        <Pencil className="size-4" />
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggle(p)} title={p.is_active ? 'Nonaktifkan' : 'Aktifkan'}>
                        <Power className={cx('size-4', p.is_active ? 'text-emerald-600' : 'text-slate-400')} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={BadgePercent} title="Tidak ada promo" description="Buat promo baru untuk mendorong penjualan." />
        )}
      </div>
      <PromoForm open={!!editing} promoId={editing?.id ?? null} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </div>
  );
}
