import { PO_STATUS_LABELS, type PurchaseOrderStatus } from '@shared/types';
import { CheckCircle2, ClipboardList, PackagePlus, Pencil, Plus, Printer, Sparkles, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFeedback } from '../../components/Feedback';
import { usePrint } from '../../components/Print';
import { ItemLinesEditor, StatusBadge, StoreSelect, type ItemLine, type ProductLite } from '../../components/shared';
import { EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Spinner, Tabs } from '../../components/ui';
import { get, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, fmtDateTime, isoDate, daysAgo, money, num, qty as fmtQty, rp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

function PoForm({ po, onClose, onSaved }: { po: any | null; onClose: () => void; onSaved: () => void }) {
  const { storeId: scope } = useAuth();
  const { toast } = useFeedback();
  const { data: suppliers } = useFetch<any[]>('/suppliers');
  const [storeId, setStoreId] = useState<number | null>(scope);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [expected, setExpected] = useState(daysAgo(-3));
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<ItemLine[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!po) return;
    setError(null);
    if (po.id) {
      setStoreId(po.store_id);
      setSupplierId(po.supplier_id);
      setExpected(po.expected_date ?? daysAgo(-3));
      setNote(po.note ?? '');
      setLines(po.items.map((i: any) => ({ product: { id: i.product_id, sku: i.sku, name: i.name, unit: i.unit, stock: 0, cost_price: i.cost_price } as ProductLite, qty: i.qty, cost_price: i.cost_price })));
    } else {
      setStoreId(scope);
      setSupplierId(null);
      setExpected(daysAgo(-3));
      setNote('');
      setLines([]);
    }
  }, [po, scope]);

  const suggest = async () => {
    if (!storeId) return setError('Pilih toko terlebih dahulu');
    const rows = await get<any[]>('/purchase-orders/suggestions', { store_id: storeId, supplier_id: supplierId });
    if (!rows.length) return toast('Tidak ada barang di bawah stok minimum untuk supplier ini', 'info');
    const existing = new Set(lines.map((l) => l.product.id));
    setLines([
      ...lines,
      ...rows
        .filter((r) => !existing.has(r.product_id))
        .map((r) => ({ product: { id: r.product_id, sku: r.sku, name: r.name, unit: r.unit, stock: r.stock, cost_price: r.cost_price, min_stock: r.min_stock } as ProductLite, qty: r.suggested_qty, cost_price: r.cost_price })),
    ]);
    if (!supplierId && rows.length) setSupplierId(rows[0].supplier_id);
    toast(`${rows.length} barang disarankan berdasarkan stok minimum`, 'info');
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { store_id: storeId, supplier_id: supplierId, expected_date: expected || null, note: note || undefined, items: lines.map((l) => ({ product_id: l.product.id, qty: l.qty, cost_price: l.cost_price ?? 0 })) };
      if (po.id) await put(`/purchase-orders/${po.id}`, body);
      else await post('/purchase-orders', body);
      toast('Purchase order tersimpan sebagai draft');
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!po}
      onClose={onClose}
      size="2xl"
      title={po?.id ? `Ubah ${po.po_no}` : 'Buat Purchase Order'}
      footer={
        <>
          <button className="btn btn-secondary mr-auto" onClick={suggest}>
            <Sparkles className="size-4" /> Saran Order Otomatis
          </button>
          <button className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" onClick={save} disabled={busy || !storeId || !supplierId || !lines.length}>
            {busy && <Spinner />} Simpan Draft
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-4">
          <StoreSelect value={storeId} onChange={setStoreId} />
          <Field label="Supplier">
            <select className="input" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— Pilih supplier —</option>
              {suppliers?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Perkiraan Tiba">
            <input type="date" className="input" value={expected} onChange={(e) => setExpected(e.target.value)} />
          </Field>
          <Field label="Catatan">
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </div>
        <ItemLinesEditor lines={lines} onChange={setLines} storeId={storeId} withCost qtyLabel="Qty Order" />
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      </div>
    </Modal>
  );
}

function PoDocument({ po, settings }: { po: any; settings: any }) {
  return (
    <div style={{ fontFamily: 'Inter, sans-serif', fontSize: '10pt', color: '#0f172a' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '2px solid #0f172a', paddingBottom: 8 }}>
        <div>
          <div style={{ fontSize: '16pt', fontWeight: 800 }}>{settings.company_name}</div>
          <div>{settings.company_address}</div>
          <div>NPWP {settings.company_npwp}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '18pt', fontWeight: 800 }}>PURCHASE ORDER</div>
          <div style={{ fontFamily: 'monospace', fontSize: '11pt' }}>{po.po_no}</div>
          <div>Tanggal: {fmtDate(po.created_at)}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, margin: '12px 0' }}>
        <div style={{ flex: 1 }}>
          <b>Kepada:</b>
          <div>{po.supplier_name}</div>
          <div>{po.supplier_address}</div>
          <div>Telp. {po.supplier_phone}</div>
        </div>
        <div style={{ flex: 1 }}>
          <b>Kirim ke:</b>
          <div>
            {po.store_code} — {po.store_name}
          </div>
          <div>{po.store_address}</div>
          <div>Perkiraan tiba: {fmtDate(po.expected_date)}</div>
          <div>Termin: {po.payment_terms} hari</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f1f5f9' }}>
            {['No', 'SKU', 'Nama Barang', 'Qty', 'Satuan', 'Harga', 'Subtotal'].map((h) => (
              <th key={h} style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: ['Qty', 'Harga', 'Subtotal'].includes(h) ? 'right' : 'left' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {po.items.map((i: any, idx: number) => (
            <tr key={i.id}>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{idx + 1}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', fontFamily: 'monospace' }}>{i.sku}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{i.name}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{fmtQty(i.qty)}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px' }}>{i.unit}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{money(i.cost_price)}</td>
              <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right' }}>{money(i.qty * i.cost_price)}</td>
            </tr>
          ))}
          <tr>
            <td colSpan={6} style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', fontWeight: 700 }}>
              TOTAL
            </td>
            <td style={{ border: '1px solid #cbd5e1', padding: '4px 6px', textAlign: 'right', fontWeight: 700 }}>{money(po.total)}</td>
          </tr>
        </tbody>
      </table>
      {po.note && <p style={{ marginTop: 8 }}>Catatan: {po.note}</p>}
      <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 48, textAlign: 'center' }}>
        <div>
          Dibuat oleh
          <div style={{ marginTop: 56, borderTop: '1px solid #0f172a', paddingTop: 4 }}>{po.created_by_name}</div>
        </div>
        <div>
          Disetujui oleh
          <div style={{ marginTop: 56, borderTop: '1px solid #0f172a', paddingTop: 4 }}>{po.approved_by_name ?? '...................'}</div>
        </div>
        <div>
          Supplier
          <div style={{ marginTop: 56, borderTop: '1px solid #0f172a', paddingTop: 4 }}>...................</div>
        </div>
      </div>
    </div>
  );
}

function PoDetail({ id, onClose, onEdit, onChanged }: { id: number | null; onClose: () => void; onEdit: (po: any) => void; onChanged: () => void }) {
  const { user, can } = useAuth();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const print = usePrint();
  const { data: settings } = useFetch<any>('/settings');
  const { data: po, error, reload } = useFetch<any>(id ? `/purchase-orders/${id}` : null);
  const canApprove = ['SUPER_ADMIN', 'HQ_ADMIN', 'STORE_MANAGER'].includes(user!.role);

  const act = async (action: 'approve' | 'cancel') => {
    if (!(await confirm({ title: action === 'approve' ? 'Setujui PO ini?' : 'Batalkan PO ini?', danger: action === 'cancel' }))) return;
    try {
      await post(`/purchase-orders/${id}/${action}`);
      toast(action === 'approve' ? 'PO disetujui' : 'PO dibatalkan');
      reload();
      onChanged();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="xl"
      title={po?.po_no ?? 'Purchase Order'}
      subtitle={po && `${po.store_code} · ${po.supplier_name}`}
      footer={
        po && (
          <>
            <button className="btn btn-secondary mr-auto" disabled={!settings} onClick={() => print(<PoDocument po={po} settings={settings} />, 'a4')}>
              <Printer className="size-4" /> Cetak PO
            </button>
            {po.status === 'DRAFT' && can('purchasing.manage') && (
              <button className="btn btn-secondary" onClick={() => onEdit(po)}>
                <Pencil className="size-4" /> Ubah
              </button>
            )}
            {['DRAFT', 'APPROVED'].includes(po.status) && can('purchasing.manage') && (
              <button className="btn btn-secondary" onClick={() => act('cancel')}>
                <XCircle className="size-4" /> Batalkan
              </button>
            )}
            {po.status === 'DRAFT' && canApprove && (
              <button className="btn btn-success" onClick={() => act('approve')}>
                <CheckCircle2 className="size-4" /> Setujui
              </button>
            )}
            {['APPROVED', 'PARTIAL'].includes(po.status) && can('inventory.manage') && (
              <button className="btn btn-primary" onClick={() => navigate(`/inventory/receipts?po=${po.id}`)}>
                <PackagePlus className="size-4" /> Terima Barang
              </button>
            )}
          </>
        )
      }
    >
      {error && <ErrorBox message={error} />}
      {!po ? (
        <Loading />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-x-8 rounded-lg bg-slate-50 p-4 sm:grid-cols-2">
            <InfoRow label="Status">
              <StatusBadge status={po.status} />
            </InfoRow>
            <InfoRow label="Perkiraan tiba">{fmtDate(po.expected_date)}</InfoRow>
            <InfoRow label="Dibuat">
              {po.created_by_name} · {fmtDateTime(po.created_at)}
            </InfoRow>
            <InfoRow label="Disetujui">{po.approved_by_name ? `${po.approved_by_name} · ${fmtDateTime(po.approved_at)}` : '—'}</InfoRow>
          </div>
          <table className="tbl rounded-lg border border-slate-200">
            <thead>
              <tr>
                <th>Barang</th>
                <th className="num">Qty Order</th>
                <th className="num">Diterima</th>
                <th className="num">Harga</th>
                <th className="num">Subtotal</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((i: any) => (
                <tr key={i.id}>
                  <td>
                    {i.name}
                    <div className="font-mono text-xs text-slate-500">{i.sku}</div>
                  </td>
                  <td className="num">
                    {fmtQty(i.qty)} {i.unit}
                  </td>
                  <td className={i.received_qty >= i.qty ? 'num text-emerald-600' : 'num text-slate-500'}>{fmtQty(i.received_qty)}</td>
                  <td className="num">{money(i.cost_price)}</td>
                  <td className="num font-semibold">{money(i.qty * i.cost_price)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4}>Total</td>
                <td className="num">{rp(po.total)}</td>
              </tr>
            </tfoot>
          </table>
          {po.note && <p className="text-sm text-slate-600">Catatan: {po.note}</p>}
        </div>
      )}
    </Modal>
  );
}

export default function Purchasing() {
  const { storeId, can } = useAuth();
  const [status, setStatus] = useState<'' | PurchaseOrderStatus>('');
  const [editing, setEditing] = useState<any | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>('/purchase-orders', { store_id: storeId, status });

  return (
    <div>
      <PageHeader
        title="Purchase Order"
        description="Pemesanan barang ke supplier dengan alur Draft → Disetujui → Diterima."
        actions={
          can('purchasing.manage') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <Plus className="size-4" /> Buat PO
            </button>
          )
        }
      />
      <div className="card">
        <div className="px-4 pt-2">
          <Tabs
            tabs={[{ key: '' as const, label: 'Semua' }, ...(Object.keys(PO_STATUS_LABELS) as PurchaseOrderStatus[]).map((k) => ({ key: k, label: PO_STATUS_LABELS[k] }))]}
            value={status}
            onChange={setStatus}
          />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <div className="overflow-x-auto">
            <table className="tbl tbl-hover">
              <thead>
                <tr>
                  <th>No. PO</th>
                  <th>Tanggal</th>
                  <th>Toko</th>
                  <th>Supplier</th>
                  <th>Perkiraan Tiba</th>
                  <th className="num">SKU</th>
                  <th className="num">Nilai</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.map((p) => (
                  <tr key={p.id} onClick={() => setDetail(p.id)}>
                    <td className="font-mono text-xs font-semibold">{p.po_no}</td>
                    <td className="text-slate-600">{fmtDate(p.created_at)}</td>
                    <td>{p.store_code}</td>
                    <td>{p.supplier_name}</td>
                    <td className={p.expected_date && p.expected_date < isoDate() && ['APPROVED', 'PARTIAL'].includes(p.status) ? 'font-semibold text-rose-600' : 'text-slate-600'}>{fmtDate(p.expected_date)}</td>
                    <td className="num">{num(p.item_count)}</td>
                    <td className="num font-semibold">{money(p.total)}</td>
                    <td>
                      <StatusBadge status={p.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={ClipboardList} title="Belum ada purchase order" />
        )}
      </div>
      <PoForm po={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <PoDetail id={detail} onClose={() => setDetail(null)} onEdit={(po) => (setDetail(null), setEditing(po))} onChanged={reload} />
    </div>
  );
}
