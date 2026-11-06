import { MOVEMENT_LABELS, type StockMovementType } from '@shared/types';
import { History, X } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ProductQuickAdd } from '../../../components/shared';
import { Badge, cx, EmptyState, ErrorBox, Field, Loading, PageHeader, Pagination } from '../../../components/ui';
import { type Paged } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { daysAgo, fmtDateTime, isoDate, qty as fmtQty } from '../../../lib/format';
import { useFetch } from '../../../lib/hooks';

export default function Movements() {
  const { storeId } = useAuth();
  const [params, setParams] = useSearchParams();
  const productId = params.get('product_id');
  const productName = params.get('name');
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate());
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const { data, error, loading, reload } = useFetch<Paged<any>>('/inventory/movements', { store_id: storeId, product_id: productId, type, from, to, page, limit: 50 });

  return (
    <div>
      <PageHeader title="Kartu Stok" description="Riwayat seluruh mutasi stok: penjualan, penerimaan, transfer, retur, dan penyesuaian." />
      <div className="card">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-4">
          <Field label="Dari">
            <input type="date" className="input" value={from} onChange={(e) => (setFrom(e.target.value), setPage(1))} />
          </Field>
          <Field label="Sampai">
            <input type="date" className="input" value={to} onChange={(e) => (setTo(e.target.value), setPage(1))} />
          </Field>
          <Field label="Jenis mutasi">
            <select className="input" value={type} onChange={(e) => (setType(e.target.value), setPage(1))}>
              <option value="">Semua</option>
              {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>
          <div className="min-w-72 flex-1">
            <span className="label">Barang</span>
            {productId ? (
              <div className="flex items-center gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm">
                <span className="flex-1 font-medium">{productName ?? `#${productId}`}</span>
                <button onClick={() => setParams({})} className="text-slate-500 hover:text-rose-600" aria-label="Hapus filter">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <ProductQuickAdd storeId={storeId} onAdd={(p) => (setParams({ product_id: String(p.id), name: p.name }), setPage(1))} placeholder="Semua barang — scan/ketik untuk filter" multiple={false} />
            )}
          </div>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Toko</th>
                    {!productId && <th>Barang</th>}
                    <th>Jenis</th>
                    <th>Referensi</th>
                    <th className="num">Masuk</th>
                    <th className="num">Keluar</th>
                    <th className="num">Saldo</th>
                    <th>Oleh</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((m) => (
                    <tr key={m.id}>
                      <td className="whitespace-nowrap text-slate-600">{fmtDateTime(m.created_at)}</td>
                      <td>{m.store_code}</td>
                      {!productId && (
                        <td>
                          <p className="font-medium">{m.product_name}</p>
                          <p className="font-mono text-xs text-slate-500">{m.sku}</p>
                        </td>
                      )}
                      <td>
                        <Badge tone={m.qty > 0 ? 'green' : 'red'}>{MOVEMENT_LABELS[m.type as StockMovementType] ?? m.type}</Badge>
                      </td>
                      <td className="font-mono text-xs">
                        {m.ref_no}
                        {m.note && <div className="font-sans text-slate-500">{m.note}</div>}
                      </td>
                      <td className="num text-emerald-600">{m.qty > 0 ? fmtQty(m.qty) : ''}</td>
                      <td className="num text-rose-600">{m.qty < 0 ? fmtQty(-m.qty) : ''}</td>
                      <td className={cx('num font-semibold', m.balance_after < 0 && 'text-rose-600')}>{fmtQty(m.balance_after)}</td>
                      <td className="text-slate-600">{m.user_name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={50} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={History} title="Tidak ada mutasi" description="Ubah periode atau filter." />
        )}
      </div>
    </div>
  );
}
