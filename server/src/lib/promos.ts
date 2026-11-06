import type { PromoRule } from '../../../shared/pricing';
import { all } from '../db';

/** Promo aktif untuk toko & tanggal tertentu, siap dipakai mesin harga. */
export function loadActivePromos(storeId: number, date: string): PromoRule[] {
  const rows = all(
    `SELECT p.*, GROUP_CONCAT(t.target_id) AS targets
     FROM promotions p LEFT JOIN promotion_targets t ON t.promotion_id = p.id
     WHERE p.is_active = 1 AND p.start_date <= ? AND p.end_date >= ? AND (p.store_id IS NULL OR p.store_id = ?)
     GROUP BY p.id`,
    date,
    date,
    storeId,
  );
  return rows.map(toPromoRule);
}

export function toPromoRule(r: Record<string, any>): PromoRule {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    type: r.type,
    value: r.value,
    buyQty: r.buy_qty,
    getQty: r.get_qty,
    minQty: r.min_qty,
    scope: r.scope,
    targetIds: r.targets ? String(r.targets).split(',').map(Number) : [],
    memberOnly: !!r.member_only,
    storeId: r.store_id,
    startDate: r.start_date,
    endDate: r.end_date,
  };
}
