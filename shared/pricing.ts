// Mesin harga: promo per item & perhitungan PPN (harga jual sudah termasuk PPN).
// Dipakai client untuk tampilan real-time dan server sebagai sumber kebenaran saat checkout.

import type { PromoType, TaxType } from './types';

export interface PromoRule {
  id: number;
  code: string;
  name: string;
  type: PromoType;
  /** PERCENT: persen, AMOUNT: potongan/unit, SPECIAL_PRICE: harga baru, BUNDLE_PRICE: harga paket. */
  value: number;
  buyQty: number | null;
  getQty: number | null;
  minQty: number;
  scope: 'PRODUCT' | 'CATEGORY';
  targetIds: number[];
  memberOnly: boolean;
  storeId: number | null;
  startDate: string;
  endDate: string;
}

export interface PricingLine {
  productId: number;
  categoryId: number | null;
  unitPrice: number;
  qty: number;
  taxType: TaxType;
  isWeighted: boolean;
}

export interface PricingContext {
  isMember: boolean;
  storeId: number;
  /** Tanggal transaksi format YYYY-MM-DD. */
  date: string;
}

export interface LinePrice {
  gross: number;
  discount: number;
  net: number;
  promoId: number | null;
  promoName: string | null;
}

export interface CartTotals {
  subtotal: number;
  discountTotal: number;
  total: number;
  taxableTotal: number;
  nonTaxableTotal: number;
  dpp: number;
  tax: number;
  itemCount: number;
}

export const roundQty = (qty: number) => Math.round(qty * 1000) / 1000;

export function promoApplies(promo: PromoRule, line: PricingLine, ctx: PricingContext): boolean {
  if (promo.memberOnly && !ctx.isMember) return false;
  if (promo.storeId !== null && promo.storeId !== ctx.storeId) return false;
  if (ctx.date < promo.startDate || ctx.date > promo.endDate) return false;
  const target = promo.scope === 'PRODUCT' ? line.productId : line.categoryId;
  if (target === null || !promo.targetIds.includes(target)) return false;
  if (line.qty < promo.minQty) return false;
  // Promo berbasis kuantitas tidak berlaku untuk barang timbang.
  if (line.isWeighted && (promo.type === 'BUY_X_GET_Y' || promo.type === 'BUNDLE_PRICE')) return false;
  return true;
}

export function promoDiscount(promo: PromoRule, line: PricingLine): number {
  const gross = Math.round(line.unitPrice * line.qty);
  let discount = 0;
  switch (promo.type) {
    case 'PERCENT':
      discount = Math.round((gross * Math.min(promo.value, 100)) / 100);
      break;
    case 'AMOUNT':
      discount = Math.round(Math.min(promo.value, line.unitPrice) * line.qty);
      break;
    case 'SPECIAL_PRICE':
      discount = Math.round(Math.max(0, line.unitPrice - promo.value) * line.qty);
      break;
    case 'BUY_X_GET_Y': {
      const buy = promo.buyQty ?? 0;
      const get = promo.getQty ?? 0;
      if (buy <= 0 || get <= 0) return 0;
      const sets = Math.floor(line.qty / (buy + get));
      discount = sets * get * line.unitPrice;
      break;
    }
    case 'BUNDLE_PRICE': {
      const size = promo.buyQty ?? 0;
      if (size <= 0) return 0;
      const bundles = Math.floor(line.qty / size);
      discount = bundles * Math.max(0, size * line.unitPrice - promo.value);
      break;
    }
  }
  return Math.max(0, Math.min(discount, gross));
}

/** Pilih promo terbaik untuk pelanggan (tidak ditumpuk). */
export function priceLine(line: PricingLine, promos: PromoRule[], ctx: PricingContext): LinePrice {
  const gross = Math.round(line.unitPrice * line.qty);
  let best: { promo: PromoRule; discount: number } | null = null;
  for (const promo of promos) {
    if (!promoApplies(promo, line, ctx)) continue;
    const discount = promoDiscount(promo, line);
    if (discount > 0 && (!best || discount > best.discount)) best = { promo, discount };
  }
  const discount = best?.discount ?? 0;
  return {
    gross,
    discount,
    net: gross - discount,
    promoId: best?.promo.id ?? null,
    promoName: best?.promo.name ?? null,
  };
}

export function summarize(
  lines: { qty: number; isWeighted: boolean; taxType: TaxType; price: LinePrice }[],
  taxRate: number,
): CartTotals {
  let subtotal = 0;
  let discountTotal = 0;
  let taxableTotal = 0;
  let nonTaxableTotal = 0;
  let itemCount = 0;
  for (const l of lines) {
    subtotal += l.price.gross;
    discountTotal += l.price.discount;
    if (l.taxType === 'PPN') taxableTotal += l.price.net;
    else nonTaxableTotal += l.price.net;
    itemCount += l.isWeighted ? 1 : l.qty;
  }
  const dpp = Math.round((taxableTotal * 100) / (100 + taxRate));
  return {
    subtotal,
    discountTotal,
    total: subtotal - discountTotal,
    taxableTotal,
    nonTaxableTotal,
    dpp,
    tax: taxableTotal - dpp,
    itemCount,
  };
}

export function pointsEarned(amount: number, pointsPerAmount: number): number {
  if (pointsPerAmount <= 0 || amount <= 0) return 0;
  return Math.floor(amount / pointsPerAmount);
}
