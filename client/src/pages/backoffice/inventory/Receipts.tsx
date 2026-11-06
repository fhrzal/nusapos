import { PackagePlus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useFeedback } from '../../../components/Feedback';
import { ItemLinesEditor, StoreSelect, type ItemLine, type ProductLite } from '../../../components/shared';
import { EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Spinner } from '../../../components/ui';
import { get, post } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { daysAgo, fmtDateTime, isoDate, money, num, qty as fmtQty, rp } from '../../../lib/format';
import { useFetch } from '../../../lib/hooks';

function ReceiptForm({ open, poId, onClose, onSaved }: { open: boolean; poId: number | null; onClose: () => void; onSaved: () => void }) {
  const { storeId: scope } = useAuth();
  const { toast } = useFeedback();
  const { data: suppliers } = useFetch<any[]>('/suppliers');
  const [storeId, setStoreId] = useState<number | null>(scope);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [po, setPo] = useState<number | null>(null);
  const [invoice, setInvoice] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: pos } = useFetch<any[]>(open && storeId ? '/purchase-orders' : null, { store_id: storeId });
  const openPos = (pos ?? []).filter((p) => ['APPROVED', 'PARTIAL'].includes(p.status) && (!supplierId || p.supplier_id === supplierId));

  const loadPo = async (id: number | null) => {
    setPo(id);
    if (!id) return;
    const d = await get(`/purchase-orders/${id}`);
    setStoreId(d.store_id);
    setSupplierId(d.supplier_id);
    setLines(
      d.items
        .filter((i: any) => i.qty > i.received_qty)
        .map((i: any) => ({
          product: { id: i.product_id, sku: i.sku, name: i.name, unit: i.unit, cost_price: i.cost_price, stock: 0, is_weighted: 0 } as ProductLite,
          qty: i.qty - i.received_qty,
          cost_price: i.cost_price,
        })),
    );
  };

  useEffect(() => {
    if (!open) return;
    setStoreId(scope);
    setSupplierId(null);
    setInvoice('');
    setNote('');
    setLines([]);
    setError(null);
    setPo(null);
    if (poId) loadPo(poId);
  }, [open, poId]);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/inventory/receipts', {
        store_id: storeId,
        supplier_id: supplierId,
        po_id: po,
        invoice_no: invoice,
        note: note || undefined,
        items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, cost_price: l.cost_price ?? 0 })),
      });
      toast('Penerimaan barang tersimpan, stok & HPP diperbarui');
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
      size="2xl"
      title="Penerimaan Barang (Goods Receipt)"
      subtitle="Stok bertambah dan HPP dihitung ulang dengan metode rata-rata bergerak."
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !lines.length || !storeId || !supplierId || !invoice.trim()}>
            {busy && <Spinner />} Simpan Penerimaan
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <StoreSelect value={storeId} onChange={setStoreId} />
          <Field label="Supplier">
            <select className="input" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)} disabled={!!po}>
              <option value="">— Pilih supplier —</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Referensi PO (opsional)">
            <select className="input" value={po ?? ''} onChange={(e) => loadPo(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Tanpa PO</option>
              {openPos.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.po_no} — {p.supplier_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="No. Faktur / Surat Jalan">
            <input className="input font-mono" value={invoice} onChange={(e) => setInvoice(e.target.value.toUpperCase())} />
          </Field>
        </div>
        <ItemLinesEditor lines={lines} onChange={setLines} storeId={storeId} withCost qtyLabel="Qty Diterima" showStock={false} />
        <Field label="Catatan">
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Mis. kondisi barang, nama pengirim" />
        </Field>
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}

function ReceiptDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data: g, error } = useFetch<any>(id ? `/inventory/receipts/${id}` : null);
  return (
    <Modal open={!!id} onClose={onClose} size="lg" title={g?.gr_no ?? 'Penerimaan Barang'} subtitle={g && `${g.store_code} · ${g.supplier_name}`}>
      {error && <ErrorBox message={error} />}
      {!g ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-x-8 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
            <InfoRow label="No. faktur">{g.invoice_no}</InfoRow>
            <InfoRow label="Referensi PO">{g.po_no ?? '—'}</InfoRow>
            <InfoRow label="Diterima">{fmtDateTime(g.created_at)}</InfoRow>
            <InfoRow label="Petugas">{g.user_name}</InfoRow>
          </div>
          <table className="tbl rounded-lg border border-slate-200">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="num">Qty</th>
                <th className="num">Harga Beli</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <div className="font-mono text-xs text-slate-500">{i.sku}</div>
                  </td>
                  <td className="num">
                    {fmtQty(i.qty)} {i.unit}
                  </td>
                  <td className="num">{money(i.cost_price)}</td>
                  <td className="num font-semibold">{money(i.qty * i.cost_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>Total</td>
                <td className="num">{rp(g.total_cost)}</td>
              </tr>
            </tfoot>
          </table>
          {g.note && <p className="text-sm text-slate-600">Catatan: {g.note}</p>}
        </div>
      )}
    </Modal>
  );
}

export default function Receipts() {
  const { storeId, can } = useAuth();
  const [params, setParams] = useSearchParams();
  const poParam = Number(params.get('po')) || null;
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate());
  const [formOpen, setFormOpen] = useState(!!poParam);
  const [detail, setDetail] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>('/inventory/receipts', { store_id: storeId, from, to });

  return (
    <div>
      <PageHeader
        title="Penerimaan Barang"
        description="Pencatatan barang masuk dari supplier, dengan atau tanpa Purchase Order."
        actions={
          can('inventory.manage') && (
            <button className="btn btn-primary" onClick={() => setFormOpen(true)}>
              <Plus className="size-4" /> Terima Barang
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
          <div className="overflow-x-auto">
            <table className="tbl tbl-hover">
              <thead>
                <tr>
                  <th>No. GR</th>
                  <th>Tanggal</th>
                  <th>Toko</th>
                  <th>Supplier</th>
                  <th>No. Faktur</th>
                  <th>PO</th>
                  <th className="num">Item</th>
                  <th className="num">Nilai</th>
                  <th>Petugas</th>
                </tr>
              </thead>
              <tbody>
                {data.map((g) => (
                  <tr key={g.id} onClick={() => setDetail(g.id)}>
                    <td className="font-mono text-xs font-semibold">{g.gr_no}</td>
                    <td className="text-slate-600">{fmtDateTime(g.created_at)}</td>
                    <td>{g.store_code}</td>
                    <td>{g.supplier_name}</td>
                    <td className="font-mono text-xs">{g.invoice_no}</td>
                    <td className="font-mono text-xs">{g.po_no ?? '—'}</td>
                    <td className="num">{num(g.item_count)}</td>
                    <td className="num font-semibold">{money(g.total_cost)}</td>
                    <td className="text-slate-600">{g.user_name}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={PackagePlus} title="Belum ada penerimaan barang" />
        )}
      </div>
      <ReceiptForm
        open={formOpen}
        poId={poParam}
        onClose={() => (setFormOpen(false), setParams({}))}
        onSaved={() => (setFormOpen(false), setParams({}), reload())}
      />
      <ReceiptDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
