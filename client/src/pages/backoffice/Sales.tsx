import { PAYMENT_LABELS, PAYMENT_METHODS, type PaymentMethod } from '@shared/types';
import { Download, Printer, Receipt as ReceiptIcon } from 'lucide-react';
import { useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { Receipt, usePrint } from '../../components/Print';
import { StatusBadge, SupervisorDialog } from '../../components/shared';
import { Badge, EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Pagination, SearchInput, StatCard } from '../../components/ui';
import { get, post, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysAgo, downloadCsv, fmtDateTime, isoDate, maskMember, money, num, qty as fmtQty, rp } from '../../lib/format';
import { useDebounced, useFetch } from '../../lib/hooks';

export function SaleDetailModal({ id, onClose, onChanged }: { id: number | null; onClose: () => void; onChanged?: () => void }) {
  const { data: sale, error, reload } = useFetch<any>(id ? `/sales/${id}` : null);
  const { data: settings } = useFetch<any>('/settings');
  const print = usePrint();
  const { toast } = useFeedback();
  const [voidOpen, setVoidOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <>
      <Modal
        open={!!id && !voidOpen}
        onClose={onClose}
        size="2xl"
        title={sale ? `Transaksi ${sale.receipt_no}` : 'Detail Transaksi'}
        subtitle={sale && `${fmtDateTime(sale.created_at)} · ${sale.store_code} / ${sale.terminal_code} · ${sale.cashier_name}`}
        footer={
          sale && (
            <>
              {sale.status === 'COMPLETED' && sale.returns.length === 0 && (
                <div className="mr-auto flex items-center gap-2">
                  <input className="input w-72" placeholder="Alasan void (min. 5 karakter)" value={reason} onChange={(e) => setReason(e.target.value)} />
                  <button className="btn btn-danger" disabled={reason.trim().length < 5} onClick={() => setVoidOpen(true)}>
                    Void
                  </button>
                </div>
              )}
              <button className="btn btn-secondary" disabled={!settings} onClick={() => print(<Receipt sale={sale} settings={settings} copy />)}>
                <Printer className="size-4" /> Cetak Ulang
              </button>
            </>
          )
        }
      >
        {error && <ErrorBox message={error} />}
        {!sale && !error && <Loading />}
        {sale && (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="tbl">
                  <thead>
                    <tr>
                      <th>Barang</th>
                      <th className="num">Qty</th>
                      <th className="num">Harga</th>
                      <th className="num">Diskon</th>
                      <th className="num">Total</th>
                      <th className="num">HPP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sale.items.map((i: any) => (
                      <tr key={i.id}>
                        <td>
                          <p className="font-medium">{i.name}</p>
                          <p className="font-mono text-xs text-slate-500">
                            {i.sku}
                            {i.tax_type === 'NON_PPN' && ' · Non-PPN'}
                          </p>
                          {i.promo_name && <Badge tone="green">{i.promo_name}</Badge>}
                          {i.returned_qty > 0 && <Badge tone="amber">Diretur {fmtQty(i.returned_qty, i.is_weighted)}</Badge>}
                        </td>
                        <td className="num">
                          {fmtQty(i.qty, i.is_weighted)} {i.unit}
                        </td>
                        <td className="num">{money(i.unit_price)}</td>
                        <td className="num text-emerald-600">{i.discount ? `-${money(i.discount)}` : '—'}</td>
                        <td className="num font-semibold">{money(i.net)}</td>
                        <td className="num text-slate-500">{money(i.cost_price * i.qty)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {sale.returns.map((r: any) => (
                <div key={r.id} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
                  <p className="font-semibold text-amber-900">
                    Retur {r.return_no} · {fmtDateTime(r.created_at)} · refund {rp(r.total_refund)}
                  </p>
                  <p className="text-amber-800">
                    Alasan: {r.reason} · oleh {r.user_name}, disetujui {r.approver_name}
                  </p>
                  <ul className="mt-1 list-disc pl-5 text-amber-800">
                    {r.items.map((ri: any) => (
                      <li key={ri.id}>
                        {ri.name} × {fmtQty(ri.qty)} = {money(ri.refund_amount)}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {sale.status === 'VOIDED' && (
                <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Di-void oleh {sale.voided_by_name} pada {fmtDateTime(sale.voided_at)}. Alasan: {sale.void_reason}
                </div>
              )}
            </div>
            <div className="space-y-4">
              <div className="rounded-lg bg-slate-50 p-4">
                <InfoRow label="Status">
                  <StatusBadge status={sale.status} />
                </InfoRow>
                <InfoRow label="Subtotal">{money(sale.subtotal)}</InfoRow>
                <InfoRow label="Diskon">-{money(sale.discount_total)}</InfoRow>
                <InfoRow label="DPP">{money(sale.dpp)}</InfoRow>
                <InfoRow label={`PPN ${sale.tax_rate}%`}>{money(sale.tax_amount)}</InfoRow>
                <div className="mt-2 flex justify-between border-t border-slate-200 pt-2 text-base font-bold">
                  <span>Total</span>
                  <span>{rp(sale.total)}</span>
                </div>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Pembayaran</p>
                {sale.payments.map((p: any) => (
                  <InfoRow key={p.id} label={`${PAYMENT_LABELS[p.method as PaymentMethod]}${p.reference ? ` · ${p.reference}` : ''}`}>
                    {money(p.amount)}
                  </InfoRow>
                ))}
                <InfoRow label="Kembalian">{money(sale.change_amount)}</InfoRow>
              </div>
              {sale.member_no && (
                <div className="rounded-lg bg-brand-50 p-4">
                  <p className="mb-1 text-xs font-semibold text-brand-700 uppercase">Member</p>
                  <InfoRow label={sale.member_name}>{maskMember(sale.member_no)}</InfoRow>
                  <InfoRow label="Poin didapat">+{sale.points_earned}</InfoRow>
                  {sale.points_redeemed > 0 && <InfoRow label="Poin dipakai">-{sale.points_redeemed}</InfoRow>}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
      <SupervisorDialog
        open={voidOpen}
        onClose={() => setVoidOpen(false)}
        description={sale && `Void ${sale.receipt_no} senilai ${rp(sale.total)}`}
        onSubmit={async (approval) => {
          await post(`/sales/${sale.id}/void`, { reason, approval });
          toast('Transaksi berhasil di-void');
          setReason('');
          reload();
          onChanged?.();
        }}
      />
    </>
  );
}

export default function Sales() {
  const { storeId } = useAuth();
  const [from, setFrom] = useState(isoDate());
  const [to, setTo] = useState(isoDate());
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const dq = useDebounced(q);
  const query = { store_id: storeId, from, to, q: dq, status, method, page, limit: 25 };
  const { data, error, loading, reload } = useFetch<Paged<any>>('/sales', query);

  const exportCsv = async () => {
    const all = await get<Paged<any>>('/sales', { ...query, page: 1, limit: 500 });
    downloadCsv(`transaksi_${from}_${to}.csv`, [
      ['No Struk', 'Waktu', 'Toko', 'Terminal', 'Kasir', 'Member', 'Item', 'Diskon', 'Total', 'Metode', 'Status'],
      ...all.data.map((s) => [s.receipt_no, s.created_at, s.store_code, s.terminal_code, s.cashier_name, s.member_name, s.item_count, s.discount_total, s.total, s.methods, s.status]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Transaksi Penjualan"
        description="Seluruh struk penjualan, termasuk void dan retur."
        actions={
          <button className="btn btn-secondary" onClick={exportCsv}>
            <Download className="size-4" /> Ekspor CSV
          </button>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        <StatCard label="Jumlah Struk" value={num(data?.summary?.count)} icon={ReceiptIcon} />
        <StatCard label="Penjualan Bersih" value={rp(data?.summary?.total)} tone="green" />
        <StatCard label="Transaksi Void" value={num(data?.summary?.voided)} tone="red" />
      </div>
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Dari">
            <input type="date" className="input" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </Field>
          <Field label="Sampai">
            <input type="date" className="input" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </Field>
          <div className="flex gap-1 pb-0.5">
            {[
              ['Hari ini', 0],
              ['7 hari', 6],
              ['30 hari', 29],
            ].map(([l, d]) => (
              <button key={l} className="btn btn-sm btn-ghost" onClick={() => (setFrom(daysAgo(d as number)), setTo(isoDate()), setPage(1))}>
                {l}
              </button>
            ))}
          </div>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
              <option value="">Semua</option>
              <option value="COMPLETED">Selesai</option>
              <option value="VOIDED">Void</option>
            </select>
          </Field>
          <Field label="Pembayaran">
            <select className="input" value={method} onChange={(e) => (setMethod(e.target.value), setPage(1))}>
              <option value="">Semua</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m.code} value={m.code}>
                  {m.label}
                </option>
              ))}
            </select>
          </Field>
          <SearchInput className="min-w-60 flex-1" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="No. struk / no. member / HP" />
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {loading && !data ? (
          <Loading />
        ) : data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="tbl tbl-hover">
                <thead>
                  <tr>
                    <th>No. Struk</th>
                    <th>Waktu</th>
                    <th>Toko / Terminal</th>
                    <th>Kasir</th>
                    <th>Member</th>
                    <th>Pembayaran</th>
                    <th className="num">Item</th>
                    <th className="num">Diskon</th>
                    <th className="num">Total</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((s) => (
                    <tr key={s.id} onClick={() => setDetail(s.id)}>
                      <td className="font-mono text-xs font-semibold">{s.receipt_no}</td>
                      <td className="text-slate-600">{fmtDateTime(s.created_at)}</td>
                      <td>
                        {s.store_code} / {s.terminal_code}
                      </td>
                      <td>{s.cashier_name}</td>
                      <td className="text-slate-600">{s.member_name ?? '—'}</td>
                      <td className="text-xs text-slate-600">
                        {String(s.methods ?? '')
                          .split(',')
                          .map((m: string) => PAYMENT_LABELS[m as PaymentMethod] ?? m)
                          .join(', ')}
                      </td>
                      <td className="num">{fmtQty(s.item_count)}</td>
                      <td className="num text-emerald-600">{s.discount_total ? money(s.discount_total) : '—'}</td>
                      <td className="num font-semibold">{money(s.total)}</td>
                      <td>
                        <div className="flex gap-1">
                          <StatusBadge status={s.status} />
                          {s.return_count > 0 && <Badge tone="amber">Retur</Badge>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={25} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={ReceiptIcon} title="Tidak ada transaksi" description="Ubah rentang tanggal atau filter pencarian." />
        )}
      </div>
      <SaleDetailModal id={detail} onClose={() => setDetail(null)} onChanged={reload} />
    </div>
  );
}
