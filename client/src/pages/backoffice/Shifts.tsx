import { CASH_MOVEMENT_LABELS, PAYMENT_LABELS, type CashMovementType, type PaymentMethod } from '@shared/types';
import { Clock, Printer } from 'lucide-react';
import { useState } from 'react';
import { ShiftReport, usePrint } from '../../components/Print';
import { StatusBadge } from '../../components/shared';
import { cx, EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Pagination } from '../../components/ui';
import { type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { daysAgo, fmtDateTime, isoDate, money, num, rp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

function ShiftDetail({ id, onClose }: { id: number | null; onClose: () => void }) {
  const { data, error } = useFetch<any>(id ? `/shifts/${id}` : null);
  const { data: settings } = useFetch<any>('/settings');
  const print = usePrint();
  const shift = data?.shift;
  return (
    <Modal
      open={!!id}
      onClose={onClose}
      size="xl"
      title={shift ? `Shift ${shift.shift_no}` : 'Detail Shift'}
      subtitle={shift && `${shift.cashier_name} · ${shift.store_code} / ${shift.terminal_code}`}
      footer={
        data && (
          <button className="btn btn-secondary" disabled={!settings} onClick={() => print(<ShiftReport summary={data} settings={settings} />)}>
            <Printer className="size-4" /> Cetak Laporan {shift.status === 'CLOSED' ? 'Z' : 'X'}
          </button>
        )
      }
    >
      {error && <ErrorBox message={error} />}
      {!data && !error && <Loading />}
      {data && (
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-4">
            <div className="rounded-lg bg-slate-50 p-4">
              <InfoRow label="Status">
                <StatusBadge status={shift.status} />
              </InfoRow>
              <InfoRow label="Dibuka">{fmtDateTime(shift.opened_at)}</InfoRow>
              <InfoRow label="Ditutup">{fmtDateTime(shift.closed_at)}</InfoRow>
              <InfoRow label="Transaksi">{num(data.sales.trx_count)}</InfoRow>
              <InfoRow label="Penjualan kotor">{rp(data.sales.gross_total)}</InfoRow>
              <InfoRow label="Diskon">-{rp(data.sales.discount_total)}</InfoRow>
              <InfoRow label="Penjualan bersih">{rp(data.sales.sales_total)}</InfoRow>
              <InfoRow label={`Void (${data.voids.count})`}>{rp(data.voids.amount)}</InfoRow>
              <InfoRow label={`Retur (${data.returns.count})`}>{rp(data.returns.amount)}</InfoRow>
            </div>
            <div className="rounded-lg bg-slate-50 p-4">
              <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Per metode pembayaran</p>
              {data.payments.map((p: any) => (
                <InfoRow key={p.method} label={`${PAYMENT_LABELS[p.method as PaymentMethod]} (${p.count})`}>
                  {rp(p.amount)}
                </InfoRow>
              ))}
            </div>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Rekonsiliasi kas laci</p>
              <InfoRow label="Modal awal">{rp(data.cash.opening)}</InfoRow>
              <InfoRow label="+ Penjualan tunai">{rp(data.cash.sales)}</InfoRow>
              <InfoRow label="+ Kas masuk">{rp(data.cash.cash_in)}</InfoRow>
              <InfoRow label="− Kas keluar">{rp(data.cash.cash_out)}</InfoRow>
              <InfoRow label="− Setoran/pickup">{rp(data.cash.pickup)}</InfoRow>
              <InfoRow label="− Refund retur">{rp(data.cash.refunds)}</InfoRow>
              <div className="mt-2 border-t border-slate-200 pt-2">
                <InfoRow label="Kas seharusnya">{rp(shift.status === 'CLOSED' ? shift.expected_cash : data.cash.expected)}</InfoRow>
                {shift.status === 'CLOSED' && (
                  <>
                    <InfoRow label="Kas dihitung">{rp(shift.counted_cash)}</InfoRow>
                    <InfoRow label="Selisih">
                      <span className={cx(shift.variance < 0 ? 'text-rose-600' : shift.variance > 0 ? 'text-amber-600' : 'text-emerald-600')}>{rp(shift.variance)}</span>
                    </InfoRow>
                  </>
                )}
              </div>
              {shift.closing_note && <p className="mt-2 text-xs text-slate-500">Catatan: {shift.closing_note}</p>}
            </div>
            {data.movements.length > 0 && (
              <div className="rounded-lg border border-slate-200 p-4">
                <p className="mb-1 text-xs font-semibold text-slate-500 uppercase">Mutasi kas</p>
                {data.movements.map((m: any) => (
                  <InfoRow key={m.id} label={`${CASH_MOVEMENT_LABELS[m.type as CashMovementType]} · ${m.reason} (spv: ${m.approver_name ?? '-'})`}>
                    {rp(m.amount)}
                  </InfoRow>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Shifts() {
  const { storeId } = useAuth();
  const [from, setFrom] = useState(daysAgo(6));
  const [to, setTo] = useState(isoDate());
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<number | null>(null);
  const { data, error, loading, reload } = useFetch<Paged<any>>('/shifts', { store_id: storeId, from, to, status, page, limit: 25 });

  return (
    <div>
      <PageHeader title="Shift Kasir" description="Riwayat buka/tutup shift, rekonsiliasi kas, dan selisih kas per kasir." />
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Dari">
            <input type="date" className="input" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </Field>
          <Field label="Sampai">
            <input type="date" className="input" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </Field>
          <Field label="Status">
            <select className="input" value={status} onChange={(e) => (setStatus(e.target.value), setPage(1))}>
              <option value="">Semua</option>
              <option value="OPEN">Berjalan</option>
              <option value="CLOSED">Ditutup</option>
            </select>
          </Field>
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
                    <th>No. Shift</th>
                    <th>Kasir</th>
                    <th>Toko / Terminal</th>
                    <th>Buka</th>
                    <th>Tutup</th>
                    <th className="num">Trx</th>
                    <th className="num">Penjualan</th>
                    <th className="num">Selisih Kas</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((s) => (
                    <tr key={s.id} onClick={() => setDetail(s.id)}>
                      <td className="font-mono text-xs font-semibold">{s.shift_no}</td>
                      <td>{s.cashier_name}</td>
                      <td>
                        {s.store_code} / {s.terminal_code}
                      </td>
                      <td className="text-slate-600">{fmtDateTime(s.opened_at)}</td>
                      <td className="text-slate-600">{fmtDateTime(s.closed_at)}</td>
                      <td className="num">{num(s.trx_count)}</td>
                      <td className="num font-semibold">{money(s.sales_total)}</td>
                      <td className={cx('num font-semibold', s.variance < 0 ? 'text-rose-600' : s.variance > 0 ? 'text-amber-600' : 'text-slate-400')}>
                        {s.variance === null ? '—' : money(s.variance)}
                      </td>
                      <td>
                        <StatusBadge status={s.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={25} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={Clock} title="Tidak ada shift" />
        )}
      </div>
      <ShiftDetail id={detail} onClose={() => setDetail(null)} />
    </div>
  );
}
