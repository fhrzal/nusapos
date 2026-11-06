import { Router } from 'express';
import { z } from 'zod';
import { pointsEarned, priceLine, roundQty, summarize, type PricingLine } from '../../../shared/pricing';
import { PAYMENT_METHODS, type PaymentMethod } from '../../../shared/types';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { badRequest, conflict, dateRange, forbidden, localDate, notFound, pagination, parse, qInt, qStr } from '../lib/http';
import { docNo, receiptNo } from '../lib/numbering';
import { loadActivePromos } from '../lib/promos';
import { getSettings } from '../lib/settings';
import { moveStock } from '../lib/stock';
import { approvalSchema, assertStoreAccess, requirePerm, scopedStoreId, verifyApproval } from '../middleware/auth';

const router = Router();

export function getSale(id: number): Record<string, any> {
  const sale = one<Record<string, any>>(
    `SELECT s.*, st.code AS store_code, st.name AS store_name, st.address AS store_address, st.phone AS store_phone,
       t.code AS terminal_code, u.full_name AS cashier_name, u.employee_no AS cashier_no, sh.shift_no,
       m.member_no, m.name AS member_name, m.points AS member_points, v.full_name AS voided_by_name
     FROM sales s JOIN stores st ON st.id = s.store_id JOIN terminals t ON t.id = s.terminal_id
     JOIN users u ON u.id = s.cashier_id JOIN shifts sh ON sh.id = s.shift_id
     LEFT JOIN members m ON m.id = s.member_id LEFT JOIN users v ON v.id = s.voided_by
     WHERE s.id = ?`,
    id,
  );
  if (!sale) throw notFound('Transaksi tidak ditemukan');
  const items = all(
    `SELECT si.*, p.barcode, p.is_weighted FROM sale_items si JOIN products p ON p.id = si.product_id WHERE si.sale_id = ? ORDER BY si.id`,
    id,
  );
  const payments = all('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id', id);
  const returns = all(
    `SELECT r.*, u.full_name AS user_name, a.full_name AS approver_name FROM sale_returns r
     JOIN users u ON u.id = r.user_id LEFT JOIN users a ON a.id = r.approved_by WHERE r.sale_id = ? ORDER BY r.id`,
    id,
  ).map((r) => ({
    ...r,
    items: all(
      `SELECT ri.*, si.name, si.sku FROM sale_return_items ri JOIN sale_items si ON si.id = ri.sale_item_id WHERE ri.return_id = ?`,
      r.id,
    ),
  }));
  return { ...sale, items, payments, returns };
}

function addPoints(memberId: number, points: number, type: string, refNo: string, note?: string) {
  if (!points) return;
  const { points: balance } = one<{ points: number }>(
    'UPDATE members SET points = MAX(0, points + ?) WHERE id = ? RETURNING points',
    points,
    memberId,
  )!;
  run(
    'INSERT INTO member_point_ledger(member_id, type, points, balance_after, ref_no, note) VALUES (?, ?, ?, ?, ?, ?)',
    memberId,
    type,
    points,
    balance,
    refNo,
    note ?? null,
  );
}

// ---------------------------------------------------------------- Checkout
const checkoutSchema = z.object({
  client_ref: z.string().min(8).max(64).optional(),
  shift_id: z.number().int(),
  member_id: z.number().int().nullable().optional(),
  items: z
    .array(z.object({ product_id: z.number().int(), qty: z.number().positive() }))
    .min(1, 'keranjang kosong')
    .max(500),
  payments: z
    .array(
      z.object({
        method: z.enum(PAYMENT_METHODS.map((m) => m.code) as [PaymentMethod, ...PaymentMethod[]]),
        amount: z.number().int().positive(),
        reference: z.string().trim().max(50).nullable().optional(),
      }),
    )
    .min(1, 'pembayaran wajib diisi')
    .max(10),
});

router.post('/checkout', requirePerm('pos.use'), (req, res) => {
  const b = parse(checkoutSchema, req.body);

  // Idempotensi: request ulang (mis. jaringan putus) tidak membuat transaksi ganda.
  if (b.client_ref) {
    const existing = one<{ id: number }>('SELECT id FROM sales WHERE client_ref = ?', b.client_ref);
    if (existing) return res.json(getSale(existing.id));
  }

  const shift = one<Record<string, any>>(
    `SELECT sh.*, t.code AS terminal_code, s.code AS store_code FROM shifts sh
     JOIN terminals t ON t.id = sh.terminal_id JOIN stores s ON s.id = sh.store_id WHERE sh.id = ?`,
    b.shift_id,
  );
  if (!shift || shift.status !== 'OPEN') throw conflict('Shift tidak aktif. Buka shift terlebih dahulu.');
  if (shift.user_id !== req.user!.id) throw forbidden('Shift ini bukan milik Anda');

  const settings = getSettings();
  const member = b.member_id
    ? one<{ id: number; points: number; member_no: string }>('SELECT id, points, member_no FROM members WHERE id = ? AND is_active = 1', b.member_id)
    : undefined;
  if (b.member_id && !member) throw badRequest('Member tidak valid / nonaktif');

  // Gabungkan baris produk yang sama (non-timbang) agar promo kuantitas dihitung benar.
  const merged: { product_id: number; qty: number }[] = [];
  const ids = [...new Set(b.items.map((i) => i.product_id))];
  const products = new Map(
    all<Record<string, any>>(`SELECT * FROM products WHERE id IN (${ids.map(() => '?').join(',')}) AND is_active = 1`, ...ids).map((p) => [
      p.id,
      p,
    ]),
  );
  for (const item of b.items) {
    const p = products.get(item.product_id);
    if (!p) throw badRequest(`Produk #${item.product_id} tidak ditemukan / nonaktif`);
    if (!p.is_weighted && !Number.isInteger(item.qty)) throw badRequest(`Qty ${p.name} harus bilangan bulat`);
    const existing = !p.is_weighted && merged.find((m) => m.product_id === item.product_id);
    if (existing) existing.qty += item.qty;
    else merged.push({ product_id: item.product_id, qty: roundQty(item.qty) });
  }

  const today = localDate();
  const promos = loadActivePromos(shift.store_id, today);
  const ctx = { isMember: !!member, storeId: shift.store_id, date: today };
  const lines = merged.map((m) => {
    const p = products.get(m.product_id)!;
    const input: PricingLine = {
      productId: p.id,
      categoryId: p.category_id,
      unitPrice: p.sell_price,
      qty: m.qty,
      taxType: p.tax_type,
      isWeighted: !!p.is_weighted,
    };
    return { product: p, qty: m.qty, isWeighted: !!p.is_weighted, taxType: p.tax_type, price: priceLine(input, promos, ctx) };
  });
  const totals = summarize(lines, settings.tax_rate);

  // Validasi pembayaran
  let nonCash = 0;
  let paid = 0;
  let pointsAmount = 0;
  for (const p of b.payments) {
    const def = PAYMENT_METHODS.find((m) => m.code === p.method)!;
    if (def.requiresReference && !p.reference) throw badRequest(`No. referensi/approval ${def.label} wajib diisi`);
    if (p.method !== 'CASH') nonCash += p.amount;
    if (p.method === 'POINTS') pointsAmount += p.amount;
    paid += p.amount;
  }
  if (nonCash > totals.total) throw badRequest('Pembayaran non-tunai tidak boleh melebihi total belanja');
  if (paid > nonCash && nonCash >= totals.total) throw badRequest('Total sudah lunas dengan pembayaran non-tunai; hapus pembayaran tunai');
  if (paid < totals.total) throw badRequest(`Pembayaran kurang Rp ${(totals.total - paid).toLocaleString('id-ID')}`);
  let pointsRedeemed = 0;
  if (pointsAmount) {
    if (!member) throw badRequest('Pembayaran poin hanya untuk member');
    if (pointsAmount % settings.point_value !== 0) throw badRequest(`Nominal poin harus kelipatan Rp ${settings.point_value}`);
    pointsRedeemed = pointsAmount / settings.point_value;
    if (pointsRedeemed > member.points) throw badRequest(`Poin member tidak cukup (sisa ${member.points} poin)`);
  }
  const change = paid - totals.total;
  const earned = member ? pointsEarned(totals.total - pointsAmount, settings.points_per_amount) : 0;

  const saleId = tx(() => {
    const no = receiptNo(shift.store_code, shift.terminal_code);
    const id = insert(
      `INSERT INTO sales(receipt_no, client_ref, store_id, terminal_id, shift_id, cashier_id, member_id, subtotal, discount_total,
         total, dpp, tax_amount, tax_rate, paid_total, change_amount, item_count, points_earned, points_redeemed)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      no,
      b.client_ref ?? null,
      shift.store_id,
      shift.terminal_id,
      shift.id,
      req.user!.id,
      member?.id ?? null,
      totals.subtotal,
      totals.discountTotal,
      totals.total,
      totals.dpp,
      totals.tax,
      settings.tax_rate,
      paid,
      change,
      totals.itemCount,
      earned,
      pointsRedeemed,
    );
    for (const l of lines) {
      const p = l.product;
      run(
        `INSERT INTO sale_items(sale_id, product_id, sku, name, unit, qty, unit_price, cost_price, gross, discount, net, tax_type,
           promo_id, promo_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        p.id,
        p.sku,
        p.name,
        p.unit,
        l.qty,
        p.sell_price,
        p.cost_price,
        l.price.gross,
        l.price.discount,
        l.price.net,
        p.tax_type,
        l.price.promoId,
        l.price.promoName,
      );
      moveStock({
        storeId: shift.store_id,
        productId: p.id,
        qty: -l.qty,
        type: 'SALE',
        refType: 'sale',
        refId: id,
        refNo: no,
        userId: req.user!.id,
        allowNegative: settings.allow_negative_stock,
      });
    }
    for (const p of b.payments) {
      run('INSERT INTO sale_payments(sale_id, method, amount, reference) VALUES (?, ?, ?, ?)', id, p.method, p.amount, p.reference ?? null);
    }
    if (member) {
      if (pointsRedeemed) addPoints(member.id, -pointsRedeemed, 'REDEEM', no);
      if (earned) addPoints(member.id, earned, 'EARN', no);
      run('UPDATE members SET total_spent = total_spent + ? WHERE id = ?', totals.total, member.id);
    }
    return id;
  });

  res.status(201).json(getSale(saleId));
});

// ---------------------------------------------------------------- Daftar & detail
router.get('/', requirePerm('sales.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { start, end } = dateRange(req, 1);
  const storeId = scopedStoreId(req, req.query.store_id);
  const conds = ['s.created_at >= ?', 's.created_at < ?'];
  const params: unknown[] = [start, end];
  if (storeId !== null) conds.push('s.store_id = ?'), params.push(storeId);
  const q = qStr(req.query.q);
  if (q) conds.push('(s.receipt_no LIKE ? OR m.member_no = ? OR m.phone = ?)'), params.push(`%${q}%`, q, q);
  const status = qStr(req.query.status);
  if (status) conds.push('s.status = ?'), params.push(status);
  const cashierId = qInt(req.query.cashier_id);
  if (cashierId) conds.push('s.cashier_id = ?'), params.push(cashierId);
  const shiftId = qInt(req.query.shift_id);
  if (shiftId) conds.push('s.shift_id = ?'), params.push(shiftId);
  const method = qStr(req.query.method);
  if (method) conds.push('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ?)'), params.push(method);
  const where = conds.join(' AND ');
  const from = `FROM sales s LEFT JOIN members m ON m.id = s.member_id WHERE ${where}`;
  const summary = one(
    `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN s.status='COMPLETED' THEN s.total END), 0) AS total,
       SUM(s.status = 'VOIDED') AS voided ${from}`,
    ...params,
  );
  const data = all(
    `SELECT s.id, s.receipt_no, s.total, s.discount_total, s.item_count, s.status, s.created_at, s.points_earned,
       st.code AS store_code, t.code AS terminal_code, u.full_name AS cashier_name, m.name AS member_name,
       (SELECT GROUP_CONCAT(DISTINCT sp.method) FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods,
       (SELECT COUNT(*) FROM sale_returns r WHERE r.sale_id = s.id) AS return_count
     FROM sales s JOIN stores st ON st.id = s.store_id JOIN terminals t ON t.id = s.terminal_id
     JOIN users u ON u.id = s.cashier_id LEFT JOIN members m ON m.id = s.member_id
     WHERE ${where} ORDER BY s.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total: summary?.count ?? 0, page, limit, summary });
});

router.get('/receipt/:no', requirePerm('pos.use', 'sales.view'), (req, res) => {
  const row = one<{ id: number; store_id: number }>('SELECT id, store_id FROM sales WHERE receipt_no = ?', req.params.no.trim());
  if (!row) throw notFound(`Struk ${req.params.no} tidak ditemukan`);
  assertStoreAccess(req, row.store_id);
  res.json(getSale(row.id));
});

router.get('/:id', requirePerm('pos.use', 'sales.view'), (req, res) => {
  const sale = getSale(Number(req.params.id));
  assertStoreAccess(req, sale.store_id);
  res.json(sale);
});

// ---------------------------------------------------------------- Void
router.post('/:id/void', requirePerm('pos.use', 'sales.view'), (req, res) => {
  const b = parse(z.object({ reason: z.string().trim().min(5, 'alasan minimal 5 karakter'), approval: approvalSchema }), req.body);
  const sale = one<Record<string, any>>('SELECT * FROM sales WHERE id = ?', req.params.id);
  if (!sale) throw notFound('Transaksi tidak ditemukan');
  assertStoreAccess(req, sale.store_id);
  if (sale.status !== 'COMPLETED') throw conflict('Transaksi sudah di-void');
  if (one('SELECT 1 FROM sale_returns WHERE sale_id = ?', sale.id)) throw conflict('Transaksi sudah memiliki retur, tidak dapat di-void');
  const shift = one<{ status: string }>('SELECT status FROM shifts WHERE id = ?', sale.shift_id)!;
  if (shift.status !== 'OPEN') throw conflict('Shift transaksi sudah ditutup. Gunakan proses retur.');
  const approver = verifyApproval(req, b.approval, sale.store_id, 'VOID_SALE');

  tx(() => {
    run(
      `UPDATE sales SET status = 'VOIDED', void_reason = ?, voided_by = ?, voided_at = datetime('now','localtime') WHERE id = ?`,
      b.reason,
      approver.id,
      sale.id,
    );
    for (const item of all<{ product_id: number; qty: number }>('SELECT product_id, qty FROM sale_items WHERE sale_id = ?', sale.id)) {
      moveStock({
        storeId: sale.store_id,
        productId: item.product_id,
        qty: item.qty,
        type: 'VOID',
        refType: 'sale',
        refId: sale.id,
        refNo: sale.receipt_no,
        userId: req.user!.id,
        allowNegative: true,
      });
    }
    if (sale.member_id) {
      if (sale.points_earned) addPoints(sale.member_id, -sale.points_earned, 'REVERSAL', sale.receipt_no, 'Void transaksi');
      if (sale.points_redeemed) addPoints(sale.member_id, sale.points_redeemed, 'REVERSAL', sale.receipt_no, 'Void transaksi');
      run('UPDATE members SET total_spent = MAX(0, total_spent - ?) WHERE id = ?', sale.total, sale.member_id);
    }
  });
  audit(req, 'SALE_VOID', 'sale', sale.id, { receipt_no: sale.receipt_no, total: sale.total, reason: b.reason, approver: approver.username }, sale.store_id);
  res.json(getSale(sale.id));
});

// ---------------------------------------------------------------- Retur
router.post('/:id/return', requirePerm('pos.use'), (req, res) => {
  const b = parse(
    z.object({
      shift_id: z.number().int(),
      reason: z.string().trim().min(5, 'alasan minimal 5 karakter'),
      items: z.array(z.object({ sale_item_id: z.number().int(), qty: z.number().positive() })).min(1, 'pilih barang yang diretur'),
      approval: approvalSchema,
    }),
    req.body,
  );
  const sale = one<Record<string, any>>(
    'SELECT s.*, st.code AS store_code FROM sales s JOIN stores st ON st.id = s.store_id WHERE s.id = ?',
    req.params.id,
  );
  if (!sale) throw notFound('Transaksi tidak ditemukan');
  if (sale.status !== 'COMPLETED') throw conflict('Transaksi sudah di-void');
  const shift = one<Record<string, any>>('SELECT * FROM shifts WHERE id = ?', b.shift_id);
  if (!shift || shift.status !== 'OPEN' || shift.user_id !== req.user!.id) throw conflict('Shift aktif Anda tidak valid');
  if (shift.store_id !== sale.store_id) throw conflict('Retur hanya dapat diproses di toko tempat transaksi dilakukan');

  const saleItems = new Map(
    all<Record<string, any>>('SELECT * FROM sale_items WHERE sale_id = ?', sale.id).map((i) => [i.id as number, i]),
  );
  const lines = b.items.map((r) => {
    const item = saleItems.get(r.sale_item_id);
    if (!item) throw badRequest('Item retur tidak sesuai dengan transaksi');
    const remaining = roundQty(item.qty - item.returned_qty);
    if (r.qty > remaining) throw badRequest(`Qty retur ${item.name} melebihi sisa (${remaining})`);
    const product = one<{ is_weighted: number }>('SELECT is_weighted FROM products WHERE id = ?', item.product_id)!;
    if (!product.is_weighted && !Number.isInteger(r.qty)) throw badRequest(`Qty retur ${item.name} harus bilangan bulat`);
    // Sisa terakhir mengambil sisa nilai agar total refund tidak selisih pembulatan.
    const refunded = Math.round((item.net * item.returned_qty) / item.qty);
    const refund = r.qty === remaining ? item.net - refunded : Math.round((item.net * r.qty) / item.qty);
    return { item, qty: r.qty, refund };
  });
  const totalRefund = lines.reduce((s, l) => s + l.refund, 0);
  const approver = verifyApproval(req, b.approval, sale.store_id, 'SALE_RETURN');
  const settings = getSettings();

  const returnId = tx(() => {
    const no = docNo('RTN', sale.store_code);
    const id = insert(
      `INSERT INTO sale_returns(return_no, sale_id, store_id, shift_id, user_id, approved_by, reason, total_refund)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      no,
      sale.id,
      sale.store_id,
      shift.id,
      req.user!.id,
      approver.id,
      b.reason,
      totalRefund,
    );
    for (const l of lines) {
      run(
        'INSERT INTO sale_return_items(return_id, sale_item_id, product_id, qty, refund_amount) VALUES (?, ?, ?, ?, ?)',
        id,
        l.item.id,
        l.item.product_id,
        l.qty,
        l.refund,
      );
      run('UPDATE sale_items SET returned_qty = round(returned_qty + ?, 3) WHERE id = ?', l.qty, l.item.id);
      moveStock({
        storeId: sale.store_id,
        productId: l.item.product_id,
        qty: l.qty,
        type: 'RETURN',
        refType: 'return',
        refId: id,
        refNo: no,
        userId: req.user!.id,
        allowNegative: true,
      });
    }
    if (sale.member_id) {
      const reverse = pointsEarned(totalRefund, settings.points_per_amount);
      if (reverse) addPoints(sale.member_id, -reverse, 'REVERSAL', no, `Retur ${sale.receipt_no}`);
      run('UPDATE members SET total_spent = MAX(0, total_spent - ?) WHERE id = ?', totalRefund, sale.member_id);
    }
    return id;
  });
  audit(req, 'SALE_RETURN', 'sale', sale.id, { receipt_no: sale.receipt_no, refund: totalRefund, reason: b.reason, approver: approver.username }, sale.store_id);
  const ret = one('SELECT * FROM sale_returns WHERE id = ?', returnId);
  res.status(201).json({ return: ret, sale: getSale(sale.id) });
});

export default router;
