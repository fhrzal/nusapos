import { ADJUSTMENT_TYPES, MOVEMENT_LABELS, type AdjustmentType } from '@shared/types';
import { ClipboardCheck, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../../components/Feedback';
import { ItemLinesEditor, StoreSelect, type ItemLine } from '../../../components/shared';
import { Badge, cx, EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Spinner } from '../../../components/ui';
import { post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { daysAgo, fmtDateTime, isoDate, money, num, qty as fmtQty } from '../../../lib/format';
import { useFetch } from '../../../lib/hooks';

const TYPE_HELP: Record<AdjustmentType, string> = {
  OPNAME: 'Isi jumlah FISIK hasil hitung. Selisih terhadap stok sistem dibukukan otomatis.',
  ADJUSTMENT: 'Isi selisih (+ menambah, − mengurangi). Gunakan untuk koreksi administrasi.',
  DAMAGE: 'Isi jumlah barang rusak yang dikeluarkan dari stok.',
  EXPIRED: 'Isi jumlah barang kedaluwarsa yang ditarik dari rak.',
  LOST: 'Isi jumlah barang hilang.',
};

function AdjustmentForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { storeId: scope } = useAuth();
  const { toast } = useFeedback();
  const [storeId, setStoreId] = useState<number | null>(scope);
  const [type, setType] = useState<AdjustmentType>('OPNAME');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setStoreId(scope);
      setLines([]);
      setNote('');
      setError(null);
    }
  }, [open, scope]);

  // Untuk opname, qty awal = stok sistem agar petugas cukup mengoreksi yang berbeda.
  const changeLines = (next: ItemLine[]) =>
    setLines(next.map((l) => (type === 'OPNAME' && !lines.some((x) => x.product.id === l.product.id) ? { ...l, qty: Math.max(0, l.product.stock) } : l)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/inventory/adjustments', { store_id: storeId, type, note, items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty })) });
      toast('Dokumen penyesuaian stok tersimpan');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const diff = (l: ItemLine) => {
    const d = type === 'OPNAME' ? l.qty - l.product.stock : type === 'ADJUSTMENT' ? l.qty : -l.qty;
    return <span className={cx('font-semibold', d < 0 ? 'text-rose-600' : d > 0 ? 'text-emerald-600' : 'text-slate-400')}>{d > 0 ? '+' : ''}{fmtQty(Math.round(d * 1000) / 1000)}</span>;
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="2xl"
      title="Stock Opname & Penyesuaian"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !storeId || !lines.length || note.trim().length < 3}>
            {busy && <Spinner />} Posting Dokumen
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <StoreSelect value={storeId} onChange={(v) => (setStoreId(v), setLines([]))} />
          <Field label="Jenis dokumen">
            <select className="input" value={type} onChange={(e) => (setType(e.target.value as AdjustmentType), setLines([]))}>
              {ADJUSTMENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MOVEMENT_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Keterangan">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. Opname rak minuman blok A" />
          </Field>
        </div>
        <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">{TYPE_HELP[type]}</p>
        {storeId ? (
          <ItemLinesEditor
            lines={lines}
            onChange={changeLines}
            storeId={storeId}
            qtyLabel={type === 'OPNAME' ? 'Qty Fisik' : type === 'ADJUSTMENT' ? 'Selisih (±)' : 'Qty Keluar'}
            extraColumn={{ header: 'Selisih', render: diff }}
          />
        ) : (
          <p className="text-sm text-slate-500">Pilih toko terlebih dahulu.</p>
        )}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}

function AdjustmentDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: a, error } = useFetch<any>(id ? `/inventory/adjustments/${id}` : null);
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={a?.adj_no ?? 'Dokumen'} subtitle={a && `${MOVEMENT_LABELS[a.type as AdjustmentType]} · ${a.store_name}`}>
      {error && <ErrorBox message={error} />}
      {!a ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg bg-slate-50 p-4">
            <InfoRow label="Tanggal">{fmtDateTime(a.created_at)}</InfoRow>
            <InfoRow label="Petugas">{a.user_name}</InfoRow>
            <InfoRow label="Keterangan">{a.note}</InfoRow>
          </div>
          <table className="tbl rounded-lg border border-slate-200">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="num">Sistem</th>
                <th className="num">Fisik/Akhir</th>
                <th className="num">Selisih</th>
                <th className="num">Nilai</th>
              </tr>
            </thead>
            <tbody>
              {a.items.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <div className="font-mono text-xs text-slate-500">{i.sku}</div>
                  </td>
                  <td className="num">{fmtQty(i.system_qty)}</td>
                  <td className="num">{fmtQty(i.actual_qty)}</td>
                  <td className={cx('num font-semibold', i.diff_qty < 0 ? 'text-rose-600' : 'text-emerald-600')}>{fmtQty(i.diff_qty)}</td>
                  <td className="num">{money(i.diff_qty * i.cost_price)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Adjustments() {
  const { storeId, can } = useAuth();
  const [from, setFrom] = useState(daysAgo(89));
  const [to, setTo] = useState(isoDate());
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>('/inventory/adjustments', { store_id: storeId, from, to });

  return (
    <div>
      <PageHeader
        title="Stock Opname & Penyesuaian"
        description="Hitung fisik, barang rusak/kedaluwarsa/hilang, dan koreksi stok — semua tercatat di kartu stok."
        actions={
          can('inventory.manage') && (
            <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Dokumen Baru
            </button>
          )
        }
      />
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Dari">
            <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Sampai">
            <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <table className="tbl tbl-hover">
            <thead>
              <tr>
                <th>No. Dokumen</th>
                <th>Tanggal</th>
                <th>Toko</th>
                <th>Jenis</th>
                <th>Keterangan</th>
                <th className="num">SKU</th>
                <th className="num">Nilai Selisih</th>
                <th>Petugas</th>
              </tr>
            </thead>
            <tbody>
              {data.map((a) => (
                <tr key={a.id} onClick={() => setDetail(a.id)}>
                  <td className="font-mono text-xs font-semibold">{a.adj_no}</td>
                  <td className="text-slate-600">{fmtDateTime(a.created_at)}</td>
                  <td>{a.store_code}</td>
                  <td>
                    <Badge tone={a.type === 'OPNAME' ? 'blue' : a.type === 'ADJUSTMENT' ? 'violet' : 'red'}>{MOVEMENT_LABELS[a.type as AdjustmentType]}</Badge>
                  </td>
                  <td className="text-slate-600">{a.note}</td>
                  <td className="num">{num(a.item_count)}</td>
                  <td className={cx('num font-semibold', a.value_diff < 0 ? 'text-rose-600' : 'text-emerald-600')}>{money(a.value_diff)}</td>
                  <td className="text-slate-600">{a.user_name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Belum ada dokumen" />
        )}
      </div>
      <AdjustmentForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => (setFormOpen(false), reload())} />
      <AdjustmentDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
