import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { ADJUSTMENT_TYPES, type AdjustmentType, type StockMovementType } from '../../../shared/types';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { badRequest, conflict, dateRange, forbidden, notFound, pagination, parse, qInt, qStr } from '../lib/http';
import { docNo } from '../lib/numbering';
import { currentStock, moveStock } from '../lib/stock';
import { assertStoreAccess, isHq, requirePerm, scopedStoreId } from '../middleware/auth';

const router = Router();

const storeCode = (id: number) => {
  const s = one<{ code: string }>('SELECT code FROM stores WHERE id = ? AND is_active = 1', id);
  if (!s) throw notFound('Toko tidak ditemukan');
  return s.code;
};

// ---------------------------------------------------------------- Saldo stok
router.get('/stock', requirePerm('inventory.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const storeId = scopedStoreId(req, req.query.store_id);
  const stockSql =
    storeId === null
      ? '(SELECT COALESCE(SUM(qty), 0) FROM stock st WHERE st.product_id = p.id)'
      : '(SELECT COALESCE(qty, 0) FROM stock st WHERE st.product_id = p.id AND st.store_id = ?)';
  const stockParams = storeId === null ? [] : [storeId];
  const conds = ['p.is_active = 1'];
  const params: unknown[] = [];
  const q = qStr(req.query.q);
  if (q) conds.push('(p.name LIKE ? OR p.sku = ? OR p.barcode = ?)'), params.push(`%${q}%`, q, q);
  const categoryId = qInt(req.query.category_id);
  if (categoryId) conds.push('p.category_id = ?'), params.push(categoryId);
  const filter = qStr(req.query.filter);
  // Ambang stok minimum berlaku per toko; untuk agregat semua toko dikalikan jumlah toko aktif.
  const minExpr = storeId === null ? 'p.min_stock * (SELECT COUNT(*) FROM stores WHERE is_active = 1)' : 'p.min_stock';
  if (filter === 'low') conds.push(`x.stock > 0 AND x.stock <= ${minExpr}`);
  if (filter === 'out') conds.push('x.stock <= 0');
  const base = `FROM (SELECT p.*, ${stockSql} AS stock FROM products p) x JOIN products p ON p.id = x.id
    LEFT JOIN categories c ON c.id = p.category_id WHERE ${conds.join(' AND ')}`;
  const summary = one(
    `SELECT COUNT(*) AS sku_count, ROUND(COALESCE(SUM(MAX(x.stock, 0) * p.cost_price), 0)) AS stock_value,
       SUM(x.stock > 0 AND x.stock <= ${minExpr}) AS low_count, SUM(x.stock <= 0) AS out_count ${base}`,
    ...stockParams,
    ...params,
  );
  const data = all(
    `SELECT p.id, p.sku, p.barcode, p.name, p.unit, p.cost_price, p.sell_price, p.min_stock, p.is_weighted,
       c.name AS category_name, x.stock, ${minExpr} AS min_threshold, MAX(x.stock, 0) * p.cost_price AS stock_value
     ${base} ORDER BY ${filter ? 'x.stock ASC,' : ''} p.name LIMIT ? OFFSET ?`,
    ...stockParams,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total: summary?.sku_count ?? 0, page, limit, summary });
});

// ---------------------------------------------------------------- Kartu stok
router.get('/movements', requirePerm('inventory.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { start, end } = dateRange(req, 30);
  const storeId = scopedStoreId(req, req.query.store_id);
  const conds = ['m.created_at >= ?', 'm.created_at < ?'];
  const params: unknown[] = [start, end];
  if (storeId !== null) conds.push('m.store_id = ?'), params.push(storeId);
  const productId = qInt(req.query.product_id);
  if (productId) conds.push('m.product_id = ?'), params.push(productId);
  const type = qStr(req.query.type);
  if (type) conds.push('m.type = ?'), params.push(type);
  const where = conds.join(' AND ');
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM stock_movements m WHERE ${where}`, ...params)!.n;
  const data = all(
    `SELECT m.*, p.sku, p.name AS product_name, p.unit, s.code AS store_code, u.full_name AS user_name
     FROM stock_movements m JOIN products p ON p.id = m.product_id JOIN stores s ON s.id = m.store_id
     LEFT JOIN users u ON u.id = m.user_id WHERE ${where} ORDER BY m.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total, page, limit });
});

// ---------------------------------------------------------------- Penyesuaian & stock opname
router.get('/adjustments', requirePerm('inventory.view'), (req, res) => {
  const { start, end } = dateRange(req, 90);
  const storeId = scopedStoreId(req, req.query.store_id);
  res.json(
    all(
      `SELECT a.*, s.code AS store_code, u.full_name AS user_name, COUNT(i.id) AS item_count,
         COALESCE(SUM(i.diff_qty * i.cost_price), 0) AS value_diff
       FROM stock_adjustments a JOIN stores s ON s.id = a.store_id LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN stock_adjustment_items i ON i.adjustment_id = a.id
       WHERE a.created_at >= ? AND a.created_at < ? ${storeId !== null ? 'AND a.store_id = ?' : ''}
       GROUP BY a.id ORDER BY a.id DESC LIMIT 200`,
      start,
      end,
      ...(storeId !== null ? [storeId] : []),
    ),
  );
});

router.get('/adjustments/:id', requirePerm('inventory.view'), (req, res) => {
  const adj = one<Record<string, any>>(
    `SELECT a.*, s.code AS store_code, s.name AS store_name, u.full_name AS user_name FROM stock_adjustments a
     JOIN stores s ON s.id = a.store_id LEFT JOIN users u ON u.id = a.user_id WHERE a.id = ?`,
    req.params.id,
  );
  if (!adj) throw notFound();
  assertStoreAccess(req, adj.store_id);
  const items = all(
    `SELECT i.*, p.sku, p.name, p.unit FROM stock_adjustment_items i JOIN products p ON p.id = i.product_id WHERE i.adjustment_id = ?`,
    adj.id,
  );
  res.json({ ...adj, items });
});

router.post('/adjustments', requirePerm('inventory.manage'), (req, res) => {
  const b = parse(
    z.object({
      store_id: z.number().int(),
      type: z.enum(ADJUSTMENT_TYPES as [AdjustmentType, ...AdjustmentType[]]),
      note: z.string().trim().min(3, 'keterangan wajib diisi'),
      items: z.array(z.object({ product_id: z.number().int(), qty: z.number() })).min(1, 'tambahkan minimal satu barang'),
    }),
    req.body,
  );
  assertStoreAccess(req, b.store_id);
  const code = storeCode(b.store_id);
  const id = tx(() => {
    const no = docNo(b.type === 'OPNAME' ? 'SO' : 'ADJ', code);
    const id = insert('INSERT INTO stock_adjustments(adj_no, store_id, type, note, user_id) VALUES (?, ?, ?, ?, ?)', no, b.store_id, b.type, b.note, req.user!.id);
    for (const item of b.items) {
      const product = one<{ cost_price: number }>('SELECT cost_price FROM products WHERE id = ?', item.product_id);
      if (!product) throw badRequest(`Produk #${item.product_id} tidak ditemukan`);
      const system = currentStock(b.store_id, item.product_id);
      let diff: number;
      if (b.type === 'OPNAME') {
        if (item.qty < 0) throw badRequest('Qty fisik tidak boleh negatif');
        diff = item.qty - system;
      } else if (b.type === 'ADJUSTMENT') {
        diff = item.qty;
      } else {
        if (item.qty <= 0) throw badRequest('Qty harus lebih dari 0');
        diff = -item.qty;
      }
      diff = Math.round(diff * 1000) / 1000;
      run(
        `INSERT INTO stock_adjustment_items(adjustment_id, product_id, system_qty, actual_qty, diff_qty, cost_price)
         VALUES (?, ?, ?, ?, ?, ?)`,
        id,
        item.product_id,
        system,
        system + diff,
        diff,
        product.cost_price,
      );
      if (diff !== 0) {
        moveStock({
          storeId: b.store_id,
          productId: item.product_id,
          qty: diff,
          type: b.type as StockMovementType,
          refType: 'adjustment',
          refId: id,
          refNo: no,
          note: b.note,
          userId: req.user!.id,
          allowNegative: b.type === 'ADJUSTMENT',
        });
      }
    }
    return id;
  });
  audit(req, `STOCK_${b.type}`, 'adjustment', id, { items: b.items.length, note: b.note }, b.store_id);
  res.status(201).json({ id });
});

// ---------------------------------------------------------------- Penerimaan barang (GR)
router.get('/receipts', requirePerm('inventory.view'), (req, res) => {
  const { start, end } = dateRange(req, 90);
  const storeId = scopedStoreId(req, req.query.store_id);
  res.json(
    all(
      `SELECT g.*, s.code AS store_code, sp.name AS supplier_name, po.po_no, u.full_name AS user_name,
         (SELECT COUNT(*) FROM goods_receipt_items i WHERE i.gr_id = g.id) AS item_count
       FROM goods_receipts g JOIN stores s ON s.id = g.store_id JOIN suppliers sp ON sp.id = g.supplier_id
       LEFT JOIN purchase_orders po ON po.id = g.po_id LEFT JOIN users u ON u.id = g.user_id
       WHERE g.created_at >= ? AND g.created_at < ? ${storeId !== null ? 'AND g.store_id = ?' : ''}
       ORDER BY g.id DESC LIMIT 200`,
      start,
      end,
      ...(storeId !== null ? [storeId] : []),
    ),
  );
});

router.get('/receipts/:id', requirePerm('inventory.view'), (req, res) => {
  const gr = one<Record<string, any>>(
    `SELECT g.*, s.code AS store_code, s.name AS store_name, sp.name AS supplier_name, po.po_no, u.full_name AS user_name
     FROM goods_receipts g JOIN stores s ON s.id = g.store_id JOIN suppliers sp ON sp.id = g.supplier_id
     LEFT JOIN purchase_orders po ON po.id = g.po_id LEFT JOIN users u ON u.id = g.user_id WHERE g.id = ?`,
    req.params.id,
  );
  if (!gr) throw notFound();
  assertStoreAccess(req, gr.store_id);
  const items = all(
    `SELECT i.*, p.sku, p.name, p.unit FROM goods_receipt_items i JOIN products p ON p.id = i.product_id WHERE i.gr_id = ?`,
    gr.id,
  );
  res.json({ ...gr, items });
});

router.post('/receipts', requirePerm('inventory.manage'), (req, res) => {
  const b = parse(
    z.object({
      store_id: z.number().int(),
      supplier_id: z.number().int(),
      po_id: z.number().int().nullable().optional(),
      invoice_no: z.string().trim().min(1, 'no. faktur/surat jalan wajib diisi'),
      note: z.string().trim().optional(),
      items: z
        .array(z.object({ product_id: z.number().int(), qty: z.number().positive(), cost_price: z.number().int().min(0) }))
        .min(1, 'tambahkan minimal satu barang'),
    }),
    req.body,
  );
  assertStoreAccess(req, b.store_id);
  const code = storeCode(b.store_id);
  const po = b.po_id ? one<Record<string, any>>('SELECT * FROM purchase_orders WHERE id = ?', b.po_id) : null;
  if (b.po_id) {
    if (!po) throw notFound('PO tidak ditemukan');
    if (!['APPROVED', 'PARTIAL'].includes(po.status)) throw conflict('PO belum disetujui atau sudah selesai');
    if (po.store_id !== b.store_id || po.supplier_id !== b.supplier_id) throw badRequest('Toko/supplier tidak sesuai dengan PO');
  }

  const id = tx(() => {
    const no = docNo('GR', code);
    const total = b.items.reduce((s, i) => s + Math.round(i.qty * i.cost_price), 0);
    const id = insert(
      `INSERT INTO goods_receipts(gr_no, store_id, supplier_id, po_id, invoice_no, total_cost, note, user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      no,
      b.store_id,
      b.supplier_id,
      b.po_id ?? null,
      b.invoice_no,
      total,
      b.note ?? null,
      req.user!.id,
    );
    for (const item of b.items) {
      const product = one<{ cost_price: number }>('SELECT cost_price FROM products WHERE id = ?', item.product_id);
      if (!product) throw badRequest(`Produk #${item.product_id} tidak ditemukan`);
      // HPP rata-rata bergerak (moving average) berdasarkan total stok seluruh toko.
      const onHand = Math.max(0, one<{ q: number }>('SELECT COALESCE(SUM(qty), 0) q FROM stock WHERE product_id = ?', item.product_id)!.q);
      const newCost = Math.round((onHand * product.cost_price + item.qty * item.cost_price) / (onHand + item.qty));
      run(`UPDATE products SET cost_price = ?, updated_at = datetime('now','localtime') WHERE id = ?`, newCost, item.product_id);
      run('INSERT INTO goods_receipt_items(gr_id, product_id, qty, cost_price) VALUES (?, ?, ?, ?)', id, item.product_id, item.qty, item.cost_price);
      moveStock({
        storeId: b.store_id,
        productId: item.product_id,
        qty: item.qty,
        type: 'RECEIVE',
        refType: 'goods_receipt',
        refId: id,
        refNo: no,
        note: `Faktur ${b.invoice_no}`,
        userId: req.user!.id,
      });
      if (po) {
        run('UPDATE purchase_order_items SET received_qty = received_qty + ? WHERE po_id = ? AND product_id = ?', item.qty, po.id, item.product_id);
      }
    }
    if (po) {
      const pending = one<{ n: number }>('SELECT COUNT(*) n FROM purchase_order_items WHERE po_id = ? AND received_qty < qty', po.id)!.n;
      run('UPDATE purchase_orders SET status = ? WHERE id = ?', pending ? 'PARTIAL' : 'RECEIVED', po.id);
    }
    return id;
  });
  audit(req, 'GOODS_RECEIPT', 'goods_receipt', id, { invoice_no: b.invoice_no, items: b.items.length, po_id: b.po_id }, b.store_id);
  res.status(201).json({ id });
});

// ---------------------------------------------------------------- Transfer antar toko
router.get('/transfers', requirePerm('inventory.view'), (req, res) => {
  const { start, end } = dateRange(req, 90);
  const storeId = scopedStoreId(req, req.query.store_id);
  res.json(
    all(
      `SELECT tr.*, fs.code AS from_code, fs.name AS from_name, ts.code AS to_code, ts.name AS to_name,
         u.full_name AS created_by_name, r.full_name AS received_by_name,
         (SELECT COUNT(*) FROM stock_transfer_items i WHERE i.transfer_id = tr.id) AS item_count,
         (SELECT COALESCE(SUM(i.qty), 0) FROM stock_transfer_items i WHERE i.transfer_id = tr.id) AS total_qty
       FROM stock_transfers tr JOIN stores fs ON fs.id = tr.from_store_id JOIN stores ts ON ts.id = tr.to_store_id
       LEFT JOIN users u ON u.id = tr.created_by LEFT JOIN users r ON r.id = tr.received_by
       WHERE tr.created_at >= ? AND tr.created_at < ? ${storeId !== null ? 'AND (tr.from_store_id = ? OR tr.to_store_id = ?)' : ''}
       ORDER BY tr.id DESC LIMIT 200`,
      start,
      end,
      ...(storeId !== null ? [storeId, storeId] : []),
    ),
  );
});

function loadTransfer(req: Request) {
  const tr = one<Record<string, any>>(
    `SELECT tr.*, fs.code AS from_code, fs.name AS from_name, ts.code AS to_code, ts.name AS to_name
     FROM stock_transfers tr JOIN stores fs ON fs.id = tr.from_store_id JOIN stores ts ON ts.id = tr.to_store_id WHERE tr.id = ?`,
    req.params.id,
  );
  if (!tr) throw notFound('Transfer tidak ditemukan');
  if (!isHq(req) && req.user!.store_id !== tr.from_store_id && req.user!.store_id !== tr.to_store_id) throw forbidden();
  return tr;
}

router.get('/transfers/:id', requirePerm('inventory.view'), (req, res) => {
  const tr = loadTransfer(req);
  const items = all(
    `SELECT i.*, p.sku, p.name, p.unit FROM stock_transfer_items i JOIN products p ON p.id = i.product_id WHERE i.transfer_id = ?`,
    tr.id,
  );
  res.json({ ...tr, items });
});

router.post('/transfers', requirePerm('inventory.manage'), (req, res) => {
  const b = parse(
    z.object({
      from_store_id: z.number().int(),
      to_store_id: z.number().int(),
      note: z.string().trim().optional(),
      items: z.array(z.object({ product_id: z.number().int(), qty: z.number().positive() })).min(1, 'tambahkan minimal satu barang'),
    }),
    req.body,
  );
  if (b.from_store_id === b.to_store_id) throw badRequest('Toko asal dan tujuan tidak boleh sama');
  assertStoreAccess(req, b.from_store_id);
  const code = storeCode(b.from_store_id);
  storeCode(b.to_store_id);
  const id = tx(() => {
    const no = docNo('TRF', code);
    const id = insert(
      'INSERT INTO stock_transfers(transfer_no, from_store_id, to_store_id, note, created_by) VALUES (?, ?, ?, ?, ?)',
      no,
      b.from_store_id,
      b.to_store_id,
      b.note ?? null,
      req.user!.id,
    );
    for (const item of b.items) {
      run('INSERT INTO stock_transfer_items(transfer_id, product_id, qty) VALUES (?, ?, ?)', id, item.product_id, item.qty);
      moveStock({
        storeId: b.from_store_id,
        productId: item.product_id,
        qty: -item.qty,
        type: 'TRANSFER_OUT',
        refType: 'transfer',
        refId: id,
        refNo: no,
        userId: req.user!.id,
      });
    }
    return id;
  });
  audit(req, 'TRANSFER_CREATE', 'transfer', id, { to_store_id: b.to_store_id, items: b.items.length }, b.from_store_id);
  res.status(201).json({ id });
});

router.post('/transfers/:id/receive', requirePerm('inventory.manage'), (req, res) => {
  const tr = loadTransfer(req);
  if (tr.status !== 'IN_TRANSIT') throw conflict('Transfer sudah diproses');
  assertStoreAccess(req, tr.to_store_id);
  tx(() => {
    for (const item of all<{ product_id: number; qty: number }>('SELECT product_id, qty FROM stock_transfer_items WHERE transfer_id = ?', tr.id)) {
      moveStock({
        storeId: tr.to_store_id,
        productId: item.product_id,
        qty: item.qty,
        type: 'TRANSFER_IN',
        refType: 'transfer',
        refId: tr.id,
        refNo: tr.transfer_no,
        userId: req.user!.id,
      });
    }
    run(`UPDATE stock_transfers SET status = 'RECEIVED', received_by = ?, received_at = datetime('now','localtime') WHERE id = ?`, req.user!.id, tr.id);
  });
  audit(req, 'TRANSFER_RECEIVE', 'transfer', tr.id, { transfer_no: tr.transfer_no }, tr.to_store_id);
  res.json({ ok: true });
});

router.post('/transfers/:id/cancel', requirePerm('inventory.manage'), (req, res) => {
  const tr = loadTransfer(req);
  if (tr.status !== 'IN_TRANSIT') throw conflict('Transfer sudah diproses');
  assertStoreAccess(req, tr.from_store_id);
  tx(() => {
    for (const item of all<{ product_id: number; qty: number }>('SELECT product_id, qty FROM stock_transfer_items WHERE transfer_id = ?', tr.id)) {
      moveStock({
        storeId: tr.from_store_id,
        productId: item.product_id,
        qty: item.qty,
        type: 'TRANSFER_IN',
        refType: 'transfer',
        refId: tr.id,
        refNo: tr.transfer_no,
        note: 'Pembatalan transfer',
        userId: req.user!.id,
      });
    }
    run(`UPDATE stock_transfers SET status = 'CANCELLED' WHERE id = ?`, tr.id);
  });
  audit(req, 'TRANSFER_CANCEL', 'transfer', tr.id, { transfer_no: tr.transfer_no }, tr.from_store_id);
  res.json({ ok: true });
});

export default router;
