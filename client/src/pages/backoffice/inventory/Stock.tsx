import { AlertTriangle, Boxes, Download, History, PackageX, Wallet } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, EmptyState, ErrorBox, Loading, PageHeader, Pagination, SearchInput, StatCard, Tabs } from '../../../components/ui';
import { get, type Paged } from '../../../lib/api';
import { useAuth } from '../../../lib/auth';
import { compactRp, downloadCsv, money, num, qty as fmtQty } from '../../../lib/format';
import { useDebounced, useFetch } from '../../../lib/hooks';

export default function Stock() {
  const { storeId, stores } = useAuth();
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [filter, setFilter] = useState<'' | 'low' | 'out'>('');
  const [page, setPage] = useState(1);
  const dq = useDebounced(q);
  const { data: categories } = useFetch<any[]>('/categories');
  const query = { store_id: storeId, q: dq, category_id: category, filter, page, limit: 30 };
  const { data, error, loading, reload } = useFetch<Paged<any>>('/inventory/stock', query);
  const s = data?.summary;

  const exportCsv = async () => {
    const all = await get<Paged<any>>('/inventory/stock', { ...query, page: 1, limit: 500 });
    downloadCsv(`stok_${storeId ? stores.find((x) => x.id === storeId)?.code : 'semua'}.csv`, [
      ['SKU', 'Barcode', 'Nama', 'Kategori', 'Satuan', 'Stok', 'Min', 'HPP', 'Nilai Stok'],
      ...all.data.map((r) => [r.sku, r.barcode, r.name, r.category_name, r.unit, r.stock, r.min_threshold, r.cost_price, Math.round(r.stock_value)]),
    ]);
  };

  return (
    <div>
      <PageHeader
        title="Stok Barang"
        description={storeId ? `Saldo stok ${stores.find((x) => x.id === storeId)?.name}` : 'Agregat seluruh toko — pilih toko di bilah atas untuk melihat per toko.'}
        actions={
          <button className="btn btn-secondary" onClick={exportCsv}>
            <Download className="size-4" /> Ekspor CSV
          </button>
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="SKU Aktif" value={num(s?.sku_count)} icon={Boxes} />
        <StatCard label="Nilai Persediaan (HPP)" value={compactRp(s?.stock_value ?? 0)} icon={Wallet} tone="green" />
        <StatCard label="Stok Menipis" value={num(s?.low_count)} icon={AlertTriangle} tone="amber" sub="di bawah stok minimum" />
        <StatCard label="Stok Habis" value={num(s?.out_count)} icon={PackageX} tone="red" />
      </div>
      <div className="card">
        <div className="px-4 pt-2">
          <Tabs
            tabs={[
              { key: '' as const, label: 'Semua' },
              { key: 'low' as const, label: 'Menipis' },
              { key: 'out' as const, label: 'Habis' },
            ]}
            value={filter}
            onChange={(v) => (setFilter(v), setPage(1))}
          />
        </div>
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <SearchInput className="min-w-64 flex-1" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Nama / SKU / barcode" />
          <select className="input w-auto" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))}>
            <option value="">Semua kategori</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
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
                    <th>SKU</th>
                    <th>Nama Barang</th>
                    <th>Kategori</th>
                    <th className="num">Stok</th>
                    <th className="num">Minimum</th>
                    <th>Status</th>
                    <th className="num">HPP</th>
                    <th className="num">Nilai Stok</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((r) => {
                    const status = r.stock <= 0 ? ['Habis', 'red'] : r.stock <= r.min_threshold ? ['Menipis', 'amber'] : ['Aman', 'green'];
                    return (
                      <tr key={r.id}>
                        <td className="font-mono text-xs">{r.sku}</td>
                        <td>
                          <p className="font-medium text-slate-900">{r.name}</p>
                          <p className="font-mono text-xs text-slate-500">{r.barcode ?? 'Timbang'}</p>
                        </td>
                        <td className="text-slate-600">{r.category_name}</td>
                        <td className="num text-base font-semibold">
                          {fmtQty(r.stock, r.is_weighted)} <span className="text-xs font-normal text-slate-500">{r.unit}</span>
                        </td>
                        <td className="num text-slate-500">{fmtQty(r.min_threshold)}</td>
                        <td>
                          <Badge tone={status[1] as 'red'}>{status[0]}</Badge>
                        </td>
                        <td className="num text-slate-600">{money(r.cost_price)}</td>
                        <td className="num">{money(r.stock_value)}</td>
                        <td>
                          <Link to={`/inventory/movements?product_id=${r.id}&name=${encodeURIComponent(r.name)}`} className="btn btn-sm btn-ghost" title="Kartu stok">
                            <History className="size-4" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={30} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={Boxes} title="Tidak ada data stok" />
        )}
      </div>
    </div>
  );
}
