import type { PromoRule } from '@shared/pricing';
import { Printer, Tags, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Barcode, usePrint } from '../../components/Print';
import { NumberInput, ProductQuickAdd, type ProductLite } from '../../components/shared';
import { EmptyState, PageHeader } from '../../components/ui';
import { get } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDate, money } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

interface LabelItem {
  product: ProductLite;
  promo: PromoRule | null;
  copies: number;
}

function promoPrice(price: number, promo: PromoRule | null): { price: number; text: string } | null {
  if (!promo) return null;
  switch (promo.type) {
    case 'PERCENT':
      return { price: Math.round(price * (1 - promo.value / 100)), text: `Hemat ${promo.value}%` };
    case 'AMOUNT':
      return { price: Math.max(0, price - promo.value), text: `Hemat Rp ${money(promo.value)}` };
    case 'SPECIAL_PRICE':
      return { price: promo.value, text: 'Harga Spesial' };
    case 'BUY_X_GET_Y':
      return { price, text: `Beli ${promo.buyQty} Gratis ${promo.getQty}` };
    case 'BUNDLE_PRICE':
      return { price: Math.round(promo.value / (promo.buyQty ?? 1)), text: `${promo.buyQty} pcs Rp ${money(promo.value)}` };
  }
}

function Label({ item, brand }: { item: LabelItem; brand: string }) {
  const { product: p, promo } = item;
  const deal = promoPrice(p.sell_price, promo);
  const discounted = deal && deal.price < p.sell_price;
  return (
    <div
      style={{ width: '63.5mm', height: '38.1mm', border: '0.3mm solid #cbd5e1', padding: '2.5mm 3mm', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', fontFamily: 'Inter, sans-serif', overflow: 'hidden', background: deal ? '#fef9c3' : '#fff' }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '6.5pt', color: '#475569' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.05em' }}>{brand.toUpperCase()}</span>
        {deal && <span style={{ background: '#dc2626', color: '#fff', fontWeight: 700, padding: '0 1.5mm', borderRadius: '1mm' }}>{promo!.memberOnly ? 'MEMBER' : 'PROMO'}</span>}
      </div>
      <div style={{ fontSize: '8pt', fontWeight: 600, lineHeight: 1.15, marginTop: '1mm', height: '7mm', overflow: 'hidden' }}>{p.name}</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginTop: 'auto' }}>
        <div>
          {discounted && <div style={{ fontSize: '7pt', textDecoration: 'line-through', color: '#64748b' }}>Rp {money(p.sell_price)}</div>}
          <div style={{ fontSize: discounted ? '15pt' : '16pt', fontWeight: 800, lineHeight: 1, color: discounted ? '#dc2626' : '#0f172a' }}>
            <span style={{ fontSize: '8pt', fontWeight: 600 }}>Rp</span> {money(discounted ? deal!.price : p.sell_price)}
          </div>
          <div style={{ fontSize: '6pt', color: '#475569', marginTop: '0.5mm' }}>
            {deal ? `${deal.text} · s.d. ${fmtDate(promo!.endDate)}` : `per ${p.unit}`}
          </div>
        </div>
        {p.barcode ? <Barcode value={p.barcode} height={22} width={0.9} fontSize={7} /> : <span style={{ fontSize: '7pt', fontFamily: 'monospace' }}>PLU {p.sku}</span>}
      </div>
      <div style={{ fontSize: '5.5pt', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
        <span>{p.sku}</span>
        <span>Cetak {fmtDate(new Date().toISOString())}</span>
      </div>
    </div>
  );
}

function LabelSheet({ items, brand }: { items: LabelItem[]; brand: string }) {
  const flat = items.flatMap((i) => Array.from({ length: i.copies }, () => i));
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 63.5mm)', gap: '0', justifyContent: 'center' }}>
      {flat.map((i, idx) => (
        <Label key={idx} item={i} brand={brand} />
      ))}
    </div>
  );
}

export default function PriceLabels() {
  const { storeId } = useAuth();
  const { data: settings } = useFetch<any>('/settings');
  const print = usePrint();
  const [items, setItems] = useState<LabelItem[]>([]);

  const add = async (p: ProductLite) => {
    if (items.some((i) => i.product.id === p.id)) return;
    const detail = storeId ? await get(`/products/${p.id}`, { store_id: storeId }) : null;
    const promos: PromoRule[] = detail?.promos ?? [];
    // Pilih promo dengan harga akhir terendah untuk ditampilkan
    const best = promos.sort((a, b) => (promoPrice(p.sell_price, a)?.price ?? 0) - (promoPrice(p.sell_price, b)?.price ?? 0))[0] ?? null;
    setItems((x) => [...x, { product: p, promo: best, copies: 1 }]);
  };

  const brand = settings?.company_brand ?? 'NusaMart';
  const total = items.reduce((s, i) => s + i.copies, 0);

  return (
    <div>
      <PageHeader
        title="Label Harga Rak"
        description={`Cetak label harga A4 (3 × 7 per halaman, 63,5 × 38,1 mm). Harga promo diambil dari promo aktif ${storeId ? 'toko terpilih' : '— pilih toko untuk menampilkan promo'}.`}
        actions={
          <button className="btn btn-primary" disabled={!items.length} onClick={() => print(<LabelSheet items={items} brand={brand} />, 'a4')}>
            <Printer className="size-4" /> Cetak {total} Label
          </button>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[420px_1fr]">
        <div className="card space-y-4 p-4">
          <ProductQuickAdd storeId={storeId} onAdd={add} />
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {items.map((i, idx) => (
              <li key={i.product.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{i.product.name}</p>
                  <p className="text-xs text-slate-500">
                    Rp {money(i.product.sell_price)}
                    {i.promo && <span className="ml-1 text-emerald-600">· {i.promo.name}</span>}
                  </p>
                </div>
                <NumberInput value={i.copies} onChange={(v) => setItems(items.map((x, j) => (j === idx ? { ...x, copies: Math.max(1, Math.min(100, Math.floor(v))) } : x)))} className="w-16" />
                <button className="rounded p-1 text-slate-400 hover:text-rose-600" onClick={() => setItems(items.filter((_, j) => j !== idx))} aria-label="Hapus">
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
            {!items.length && <li className="px-3 py-8 text-center text-sm text-slate-500">Scan atau cari produk untuk dibuatkan label.</li>}
          </ul>
        </div>
        <div className="card overflow-auto p-6">
          {items.length ? (
            <div className="origin-top-left">
              <LabelSheet items={items} brand={brand} />
            </div>
          ) : (
            <EmptyState icon={Tags} title="Pratinjau label" description="Label yang ditambahkan akan tampil di sini." />
          )}
        </div>
      </div>
    </div>
  );
}
