import { PAYMENT_LABELS, type PaymentMethod } from '@shared/types';
import { AlertTriangle, Banknote, Percent, Receipt, RefreshCw, ShoppingBag, TrendingUp, Users } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BarChart, HBarList, LineChart, SERIES } from '../../components/charts';
import { StatusBadge } from '../../components/shared';
import { ErrorBox, Loading, PageHeader, StatCard } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { compactRp, fmtDateTime, fmtTime, money, num, pct, qty as fmtQty, rp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

const delta = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);

export default function Dashboard() {
  const { storeId, stores, user } = useAuth();
  const { data, error, loading, reload } = useFetch<any>('/reports/dashboard', { store_id: storeId });

  // Segarkan otomatis setiap 60 detik
  useEffect(() => {
    const t = setInterval(reload, 60000);
    return () => clearInterval(t);
  }, [reload]);

  const storeName = storeId ? stores.find((s) => s.id === storeId)?.name : 'Seluruh jaringan toko';
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const { today, yesterday, month } = data;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Selamat datang, ${user?.full_name.split(' ')[0]}`}
        description={`${storeName} · data diperbarui otomatis tiap menit`}
        actions={
          <button className="btn btn-secondary" onClick={reload} disabled={loading}>
            <RefreshCw className={loading ? 'size-4 animate-spin' : 'size-4'} /> Segarkan
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Penjualan Hari Ini" value={compactRp(today.sales)} delta={delta(today.sales, yesterday.sales)} sub="vs kemarin (jam yang sama)" icon={Banknote} />
        <StatCard label="Transaksi" value={num(today.trx)} delta={delta(today.trx, yesterday.trx)} sub={`${num(today.items)} item terjual`} icon={Receipt} tone="violet" />
        <StatCard label="Rata-rata Belanja" value={rp(today.avg_basket)} delta={delta(today.avg_basket, yesterday.avg_basket)} sub="per transaksi (ATV)" icon={ShoppingBag} tone="cyan" />
        <StatCard label="Laba Kotor Hari Ini" value={compactRp(today.gross_profit)} sub={`margin ${pct(today.margin_pct)} (excl. PPN)`} icon={TrendingUp} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Penjualan Bulan Ini" value={compactRp(month.sales)} sub={`${num(month.trx)} transaksi · retur ${compactRp(month.returns)}`} tone="blue" />
        <StatCard label="Laba Kotor Bulan Ini" value={compactRp(month.gross_profit)} sub={`margin ${pct(month.margin_pct)}`} tone="green" />
        <StatCard label="Transaksi Member" value={pct(today.trx ? (today.member_trx / today.trx) * 100 : 0)} sub={`${num(today.member_trx)} transaksi hari ini`} icon={Users} tone="amber" />
        <StatCard label="Diskon Promo Hari Ini" value={compactRp(today.discount)} sub={`${pct(today.sales ? (today.discount / (today.sales + today.discount)) * 100 : 0)} dari penjualan kotor`} icon={Percent} tone="red" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
        <div className="card xl:col-span-3">
          <div className="card-header">
            <h2 className="card-title">Tren Penjualan 30 Hari</h2>
            <span className="text-xs text-slate-500">Penjualan bersih per hari</span>
          </div>
          <div className="p-4">
            <BarChart
              data={data.trend.map((d: any) => ({
                label: new Date(d.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }),
                value: d.sales,
                detail: `${num(d.trx)} transaksi`,
              }))}
              format={rp}
              axisFormat={compactRp}
              highlightLast
            />
          </div>
        </div>
        <div className="card xl:col-span-2">
          <div className="card-header">
            <h2 className="card-title">Penjualan per Jam</h2>
          </div>
          <div className="p-4">
            <LineChart
              labels={data.hourly.map((h: any) => `${String(h.hour).padStart(2, '0')}:00`)}
              series={[
                { name: 'Hari ini', values: data.hourly.map((h: any) => h.today), color: SERIES[0] },
                { name: 'Kemarin', values: data.hourly.map((h: any) => h.yesterday), color: SERIES[1], dashed: true },
              ]}
              format={rp}
              axisFormat={compactRp}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Penjualan per Kategori</h2>
            <span className="text-xs text-slate-500">30 hari</span>
          </div>
          <div className="p-5">
            <HBarList items={data.categories.slice(0, 8).map((c: any) => ({ label: c.name, value: c.revenue }))} format={compactRp} showShare />
          </div>
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Metode Pembayaran</h2>
            <span className="text-xs text-slate-500">30 hari</span>
          </div>
          <div className="p-5">
            <HBarList
              items={data.payments.map((p: any) => ({ label: PAYMENT_LABELS[p.method as PaymentMethod], value: p.amount, sub: `${num(p.count)} transaksi` }))}
              format={compactRp}
              color={SERIES[2]}
              showShare
            />
          </div>
        </div>
        <div className="card lg:col-span-2 xl:col-span-1">
          <div className="card-header">
            <h2 className="card-title">Produk Terlaris</h2>
            <span className="text-xs text-slate-500">7 hari</span>
          </div>
          <table className="tbl">
            <tbody>
              {data.topProducts.map((p: any, i: number) => (
                <tr key={p.product_id}>
                  <td className="w-8 text-slate-400 tabular-nums">{i + 1}</td>
                  <td>
                    <p className="font-medium text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-500">{fmtQty(p.qty)} terjual</p>
                  </td>
                  <td className="num font-semibold">{compactRp(p.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {data.stores.length > 0 && (
          <div className="card">
            <div className="card-header">
              <h2 className="card-title">Performa Toko Bulan Ini</h2>
            </div>
            <div className="p-5">
              <HBarList
                items={data.stores.map((s: any) => ({
                  label: `${s.code} — ${s.name}`,
                  value: s.month_sales,
                  sub: `Hari ini ${compactRp(s.today_sales)} · ${num(s.today_trx)} trx`,
                }))}
                format={compactRp}
              />
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-header">
            <h2 className="card-title flex items-center gap-2">
              <AlertTriangle className="size-4 text-amber-500" /> Stok Menipis
            </h2>
            <Link to="/inventory/stock" className="text-xs font-semibold text-brand-600 hover:underline">
              {num(data.lowStockCount)} item · lihat semua
            </Link>
          </div>
          <table className="tbl">
            <tbody>
              {data.lowStock.map((p: any) => (
                <tr key={`${p.store_code}-${p.id}`}>
                  <td>
                    <p className="font-medium text-slate-800">{p.name}</p>
                    <p className="text-xs text-slate-500">
                      {p.store_code} · min {num(p.min_stock)} {p.unit}
                    </p>
                  </td>
                  <td className="num font-semibold text-rose-600">{fmtQty(p.stock)}</td>
                </tr>
              ))}
              {!data.lowStock.length && (
                <tr>
                  <td className="py-6 text-center text-slate-500">Semua stok aman 👍</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-header">
            <h2 className="card-title">Shift Aktif & Transaksi Terbaru</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {data.openShifts.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="size-2 rounded-full bg-emerald-500" />
                <span className="flex-1">
                  <b>{s.cashier_name}</b>
                  <span className="text-slate-500">
                    {' '}
                    · {s.store_code}/{s.terminal_code} · sejak {fmtTime(s.opened_at)}
                  </span>
                </span>
                <span className="font-mono text-xs">{money(s.sales_total)}</span>
              </div>
            ))}
            {data.recent.map((s: any) => (
              <div key={s.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                <span className="flex-1">
                  <span className="font-mono text-xs">{s.receipt_no}</span>
                  <span className="block text-xs text-slate-500">
                    {s.cashier_name} · {fmtDateTime(s.created_at)}
                  </span>
                </span>
                {s.status !== 'COMPLETED' && <StatusBadge status={s.status} />}
                <span className="font-mono text-sm font-semibold">{money(s.total)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
