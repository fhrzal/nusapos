import { ArrowLeftRight, ArrowRight, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../../components/Feedback';
import { ItemLinesEditor, StatusBadge, StoreSelect, type ItemLine } from '../../../components/shared';
import { EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Spinner } from '../../../components/ui';
import { post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { daysAgo, fmtDateTime, isoDate, num, qty as fmtQty } from '../../../lib/format';
import { useFetch } from '../../../lib/hooks';

function TransferForm({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const { storeId, stores } = useAuth();
  const { toast } = useFeedback();
  const [from, setFrom] = useState<number | null>(storeId);
  const [to, setTo] = useState<number | null>(null);
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFrom(storeId);
      setTo(null);
      setNote('');
      setLines([]);
      setError(null);
    }
  }, [open, storeId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/inventory/transfers', { from_store_id: from, to_store_id: to, note: note || undefined, items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty })) });
      toast('Transfer dibuat — stok toko asal sudah dikurangi');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title="Transfer Stok Antar Toko"
      subtitle="Stok berpindah status 'Dalam Perjalanan' sampai toko tujuan mengonfirmasi penerimaan."
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !from || !to || !lines.length}>
            {busy && <Spinner />} Kirim Transfer
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
          <StoreSelect value={from} onChange={(v) => (setFrom(v), setLines([]))} label="Dari toko" />
          <ArrowRight className="mb-2.5 hidden size-5 text-slate-400 md:block" />
          <Field label="Ke toko">
            <select className="input" value={to ?? ''} onChange={(e) => setTo(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Pilih toko tujuan —</option>
              {stores
                .filter((s) => s.id !== from)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
            </select>
          </Field>
        </div>
        {from ? <ItemLinesEditor lines={lines} onChange={setLines} storeId={from} qtyLabel="Qty Kirim" /> : <p className="text-sm text-slate-500">Pilih toko asal terlebih dahulu.</p>}
        <Field label="Catatan">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. no. kendaraan / pengemudi" />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}

function TransferDetail({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged: () => void }) {
  const { user, can } = useAuth();
  const { toast, confirm } = useFeedback();
  const { data: t, error, reload } = useFetch<any>(id ? `/inventory/transfers/${id}` : null);
  const act = async (action: 'receive' | 'cancel') => {
    if (!(await confirm({ title: action === 'receive' ? 'Konfirmasi penerimaan transfer?' : 'Batalkan transfer?', message: action === 'receive' ? 'Pastikan fisik barang sudah dicek sesuai daftar.' : 'Stok dikembalikan ke toko asal.', danger: action === 'cancel' }))) return;
    try {
      await post(`/inventory/transfers/${id}/${action}`);
      toast(action === 'receive' ? 'Transfer diterima, stok toko tujuan bertambah' : 'Transfer dibatalkan');
      reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const isHq = user?.store_id === null;
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="lg"
      title={t?.transfer_no ?? 'Transfer'}
      subtitle={t && `${t.from_code} → ${t.to_code}`}
      footer={
        t?.status === 'IN_TRANSIT' &&
        can('inventory.manage') && (
          <>
            {(isHq || user?.store_id === t.from_store_id) && (
              <button className="btn btn-secondary" onClick={() => act('cancel')}>
                Batalkan
              </button>
            )}
            {(isHq || user?.store_id === t.to_store_id) && (
              <button className="btn btn-primary" onClick={() => act('receive')}>
                Terima Barang
              </button>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox message={error} />}
      {!t ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-x-8 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
            <InfoRow label="Status">
              <StatusBadge status={t.status} />
            </InfoRow>
            <InfoRow label="Dibuat">{fmtDateTime(t.created_at)}</InfoRow>
            <InfoRow label="Dari">{t.from_name}</InfoRow>
            <InfoRow label="Ke">{t.to_name}</InfoRow>
            <InfoRow label="Diterima">{fmtDateTime(t.received_at)}</InfoRow>
            <InfoRow label="Catatan">{t.note ?? '—'}</InfoRow>
          </div>
          <table className="tbl rounded-lg border border-slate-200">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="num">Qty</th>
              </tr>
            </thead>
            <tbody>
              {t.items.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <span className="ml-2 font-mono text-xs text-slate-500">{i.sku}</span>
                  </td>
                  <td className="num font-semibold">
                    {fmtQty(i.qty)} {i.unit}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export default function Transfers() {
  const { storeId, can } = useAuth();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate());
  const [formOpen, setFormOpen] = useState(false);
  const [detail, setDetail] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>('/inventory/transfers', { store_id: storeId, from, to });

  return (
    <div>
      <PageHeader
        title="Transfer Stok"
        description="Perpindahan barang antar toko / gudang distribusi."
        actions={
          can('inventory.manage') && (
            <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Buat Transfer
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
                <th>No. Transfer</th>
                <th>Tanggal</th>
                <th>Rute</th>
                <th className="num">SKU</th>
                <th className="num">Total Qty</th>
                <th>Dibuat oleh</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.map((t) => (
                <tr key={t.id} onClick={() => setDetail(t.id)}>
                  <td className="font-mono text-xs font-semibold">{t.transfer_no}</td>
                  <td className="text-slate-600">{fmtDateTime(t.created_at)}</td>
                  <td>
                    {t.from_code} <ArrowRight className="mx-1 inline size-3.5 text-slate-400" /> {t.to_code}
                  </td>
                  <td className="num">{num(t.item_count)}</td>
                  <td className="num">{fmtQty(t.total_qty)}</td>
                  <td className="text-slate-600">{t.created_by_name}</td>
                  <td>
                    <StatusBadge status={t.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={ArrowLeftRight} title="Belum ada transfer" />
        )}
      </div>
      <TransferForm open={formOpen} onClose={() => setFormOpen(false)} onSaved={() => (setFormOpen(false), reload())} />
      <TransferDetail id={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </div>
  );
}
