import type { StockMovementType } from '../../../shared/types';
import { one, run } from '../db';
import { conflict } from './http';

export interface StockMove {
  storeId: number;
  productId: number;
  /** Positif = masuk, negatif = keluar. */
  qty: number;
  type: StockMovementType;
  refType?: string;
  refId?: number;
  refNo?: string;
  note?: string;
  userId?: number | null;
  allowNegative?: boolean;
  createdAt?: string;
}

/** Ubah saldo stok dan catat ke kartu stok. Wajib dipanggil di dalam transaksi DB. */
export function moveStock(m: StockMove): number {
  run('INSERT INTO stock(store_id, product_id, qty) VALUES (?, ?, 0) ON CONFLICT DO NOTHING', m.storeId, m.productId);
  const { qty: balance } = one<{ qty: number }>(
    `UPDATE stock SET qty = round(qty + ?, 3), updated_at = datetime('now','localtime')
     WHERE store_id = ? AND product_id = ? RETURNING qty`,
    m.qty,
    m.storeId,
    m.productId,
  )!;
  if (balance < 0 && !m.allowNegative) {
    const p = one<{ name: string }>('SELECT name FROM products WHERE id = ?', m.productId);
    throw conflict(`Stok "${p?.name ?? m.productId}" tidak mencukupi (kurang ${Math.abs(balance)})`);
  }
  run(
    `INSERT INTO stock_movements(store_id, product_id, type, qty, balance_after, ref_type, ref_id, ref_no, note, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now','localtime')))`,
    m.storeId,
    m.productId,
    m.type,
    m.qty,
    balance,
    m.refType ?? null,
    m.refId ?? null,
    m.refNo ?? null,
    m.note ?? null,
    m.userId ?? null,
    m.createdAt ?? null,
  );
  return balance;
}

export function currentStock(storeId: number, productId: number): number {
  return one<{ qty: number }>('SELECT qty FROM stock WHERE store_id = ? AND product_id = ?', storeId, productId)?.qty ?? 0;
}
