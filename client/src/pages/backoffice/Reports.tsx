import { PAYMENT_LABELS, type PaymentMethod } from '@shared/types';
import { BarChart3, Download } from 'lucide-react';
import { useState } from 'react';
import { BarChart, HBarList } from '../../components/charts';
import { EmptyState, ErrorBox, Field, Loading, PageHeader, StatCard, Tabs } from '../../components/ui';
import { useAuth } from '../../lib/auth';
import { compactRp, daysAgo, downloadCsv, isoDate, money, num, pct, qty as fmtQty } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

type Group = 'day' | 'hour' | 'store' | 'cashier' | 'terminal' | 'category' | 'product' | 'supplier' | 'promo' | 'payment';
const GROUPS: { key: Group; label: string }[] = [
  { key: 'day', label: 'Harian' },
  { key: 'hour', label: 'Per Jam' },
  { key: 'store', label: 'Per Toko' },
  { key: 'cashier', label: 'Per Kasir' },
  { key: 'terminal', label: 'Per Terminal' },
  { key: 'category', label: 'Per Kategori' },
  { key: 'product', label: 'Per Produk' },
  { key: 'supplier', label: 'Per Supplier' },
  { key: 'promo', label: 'Per Promo' },
  { key: 'payment', label: 'Per Pembayaran' },
];
const ITEM_GROUPS: Group[] = ['category', 'product', 'supplier', 'promo'];
const SALES_GROUPS: Group[] = ['day', 'hour', 'store', 'cashier', 'terminal'];

interface Col {
  key: string;
  label: string;
  fmt?: (v: any, r: any) => string;
  num?: boolean;
}

export default function Reports() {
  const { storeId } = useAuth();
  const [from, setFrom] = useState(daysAgo(29));
  const [to, setTo] = useState(isoDate());
  const [group, setGroup] = useState<Group>('day');
  const { data, error, loading, reload } = useFetch<any>('/reports/sales', { store_id: storeId, from, to, group_by: group });

  const rows: any[] = data?.rows ?? [];
  const s = data?.summary;
  const label = (r: any) => (group === 'payment' ? PAYMENT_LABELS[r.label as PaymentMethod] : group === 'day' ? new Date(r.label).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: 'short' }) : r.label);
  const paymentTotal = rows.reduce((t, r) => t + (r.net ?? 0), 0);

  const cols: Col[] = SALES_GROUPS.includes(group)
    ? [
        { key: 'trx', label: 'Transaksi', num: true, fmt: (v) => num(v) },
        { key: 'items', label: 'Item', num: true, fmt: (v) => fmtQty(v) },
        { key: 'gross', label: 'Penjualan Kotor', num: true, fmt: money },
        { key: 'discount', label: 'Diskon', num: true, fmt: money },
        { key: 'net', label: 'Penjualan Bersih', num: true, fmt: money },
        { key: 'tax', label: 'PPN', num: true, fmt: money },
        { key: 'avg_basket', label: 'Rata-rata/Trx', num: true, fmt: money },
        { key: 'member_trx', label: '% Member', num: true, fmt: (v, r) => pct(r.trx ? (v / r.trx) * 100 : 0) },
      ]
    : ITEM_GROUPS.includes(group)
      ? [
          { key: 'qty', label: 'Qty', num: true, fmt: (v) => fmtQty(v) },
          { key: 'trx', label: 'Transaksi', num: true, fmt: (v) => num(v) },
          { key: 'gross', label: 'Kotor', num: true, fmt: money },
          { key: 'discount', label: 'Diskon', num: true, fmt: money },
          { key: 'net', label: 'Bersih (incl. PPN)', num: true, fmt: money },
          { key: 'revenue_excl_tax', label: 'Bersih (excl. PPN)', num: true, fmt: money },
          { key: 'cogs', label: 'HPP', num: true, fmt: money },
          { key: 'gross_profit', label: 'Laba Kotor', num: true, fmt: money },
          { key: 'margin', label: 'Margin', num: true, fmt: (_, r) => pct(r.revenue_excl_tax ? (r.gross_profit / r.revenue_excl_tax) * 100 : 0) },
        ]
      : [
          { key: 'trx', label: 'Jumlah Pembayaran', num: true, fmt: (v) => num(v) },
          { key: 'net', label: 'Nominal', num: true, fmt: money },
          { key: 'share', label: 'Porsi', num: true, fmt: (_, r) => pct((r.net / (paymentTotal || 1)) * 100) },
        ];

  const sum = (k: string) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  const footer = (c: Col) => {
    if (['avg_basket', 'share', 'margin', 'member_trx'].includes(c.key)) {
      if (c.key === 'margin') return pct(sum('revenue_excl_tax') ? (sum('gross_profit') / sum('revenue_excl_tax')) * 100 : 0);
      if (c.key === 'avg_basket') return money(sum('trx') ? sum('net') / sum('trx') : 0);
      if (c.key === 'member_trx') return pct(sum('trx') ? (sum('member_trx') / sum('trx')) * 100 : 0);
      return '100%';
    }
    return c.fmt ? c.fmt(sum(c.key), {}) : String(sum(c.key));
  };

  const exportCsv = () =>
    downloadCsv(`laporan_${group}_${from}_${to}.csv`, [
      [GROUPS.find((g) => g.key === group)!.label, ...(group === 'product' ? ['SKU'] : []), ...cols.map((c) => c.label)],
      ...rows.map((r) => [label(r), ...(group === 'product' ? [r.code] : []), ...cols.map((c) => (c.key === 'margin' || c.key === 'share' || c.key === 'member_trx' ? c.fmt!(r[c.key], r) : r[c.key]))]),
    ]);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Laporan Penjualan"
        description="Analisis penjualan, margin, dan kontribusi per dimensi."
        actions={
          <button className="btn btn-secondary" onClick={exportCsv} disabled={!rows.length}>
            <Download className="size-4" /> Ekspor CSV
          </button>
        }
      />
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <Field label="Dari">
          <input type="date" className="input" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label="Sampai">
          <input type="date" className="input" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <div className="flex gap-1 pb-0.5">
          {[
            ['Hari ini', 0],
            ['7 hari', 6],
            ['30 hari', 29],
            ['90 hari', 89],
          ].map(([l, d]) => (
            <button key={l} className="btn btn-sm btn-ghost" onClick={() => (setFrom(daysAgo(d as number)), setTo(isoDate()))}>
              {l}
            </button>
          ))}
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => {
              const n = new Date();
              setFrom(isoDate(new Date(n.getFullYear(), n.getMonth(), 1)));
              setTo(isoDate());
            }}
          >
            Bulan ini
          </button>
        </div>
      </div>

      {s && (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Penjualan Bersih" value={compactRp(s.sales)} sub={`${num(s.trx)} transaksi`} />
          <StatCard label="Retur" value={compactRp(s.returns)} sub={`net ${compactRp(s.net_sales)}`} tone="red" />
          <StatCard label="Diskon Promo" value={compactRp(s.discount)} tone="amber" />
          <StatCard label="Rata-rata/Trx" value={compactRp(s.avg_basket)} tone="cyan" />
          <StatCard label="Laba Kotor" value={compactRp(s.gross_profit)} tone="green" />
          <StatCard label="Margin" value={pct(s.margin_pct)} sub="atas penjualan excl. PPN" tone="violet" />
        </div>
      )}

      <div className="card">
        <div className="px-4 pt-2">
          <Tabs tabs={GROUPS} value={group} onChange={setGroup} />
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {loading && !data ? (
          <Loading />
        ) : !rows.length ? (
          <EmptyState icon={BarChart3} title="Tidak ada data" description="Belum ada penjualan pada periode ini." />
        ) : (
          <>
            <div className="border-b border-slate-100 p-5">
              {group === 'day' || group === 'hour' ? (
                <BarChart data={rows.map((r) => ({ label: label(r), value: r.net, detail: `${num(r.trx)} transaksi` }))} format={(v) => `Rp ${money(v)}`} axisFormat={compactRp} />
              ) : (
                <div className="max-w-3xl">
                  <HBarList items={rows.slice(0, 10).map((r) => ({ label: label(r), value: r.net }))} format={compactRp} showShare={group === 'payment' || group === 'category' || group === 'store'} />
                </div>
              )}
            </div>
            <div className="max-h-[70vh] overflow-auto">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>{GROUPS.find((g) => g.key === group)!.label.replace('Per ', '')}</th>
                    {cols.map((c) => (
                      <th key={c.key} className="num">
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50">
                      <td>
                        <span className="font-medium text-slate-800">{label(r)}</span>
                        {r.code && <span className="ml-2 font-mono text-xs text-slate-500">{r.code}</span>}
                      </td>
                      {cols.map((c) => (
                        <td key={c.key} className="num">
                          {c.fmt ? c.fmt(r[c.key], r) : r[c.key]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td>Total ({rows.length} baris)</td>
                    {cols.map((c) => (
                      <td key={c.key} className="num">
                        {footer(c)}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
