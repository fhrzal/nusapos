import { Router } from 'express';
import { z } from 'zod';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { badRequest, conflict, dateSchema, forbidden, notFound, parse, qInt, qStr } from '../lib/http';
import { docNo } from '../lib/numbering';
import { assertStoreAccess, requirePerm, requireStoreId, scopedStoreId } from '../middleware/auth';

const router = Router();
router.use(requirePerm('purchasing.manage', 'inventory.view'));

const APPROVER_ROLES = ['SUPER_ADMIN', 'HQ_ADMIN', 'STORE_MANAGER'];

router.get('/', (req, res) => {
  const storeId = scopedStoreId(req, req.query.store_id);
  const status = qStr(req.query.status);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (storeId !== null) conds.push('po.store_id = ?'), params.push(storeId);
  if (status) conds.push('po.status = ?'), params.push(status);
  res.json(
    all(
      `SELECT po.*, s.code AS store_code, sp.name AS supplier_name, u.full_name AS created_by_name, a.full_name AS approved_by_name,
         (SELECT COUNT(*) FROM purchase_order_items i WHERE i.po_id = po.id) AS item_count
       FROM purchase_orders po JOIN stores s ON s.id = po.store_id JOIN suppliers sp ON sp.id = po.supplier_id
       LEFT JOIN users u ON u.id = po.created_by LEFT JOIN users a ON a.id = po.approved_by
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY po.id DESC LIMIT 300`,
      ...params,
    ),
  );
});

/** Saran order: barang di bawah stok minimum, dikurangi PO yang masih berjalan. */
router.get('/suggestions', (req, res) => {
  const storeId = requireStoreId(req, req.query.store_id);
  const supplierId = qInt(req.query.supplier_id);
  const rows = all<Record<string, any>>(
    `SELECT p.id AS product_id, p.sku, p.name, p.unit, p.cost_price, p.min_stock, p.supplier_id, sp.name AS supplier_name,
       COALESCE(st.qty, 0) AS stock,
       COALESCE((SELECT SUM(i.qty - i.received_qty) FROM purchase_order_items i JOIN purchase_orders po ON po.id = i.po_id
         WHERE i.product_id = p.id AND po.store_id = ? AND po.status IN ('DRAFT','APPROVED','PARTIAL')), 0) AS on_order
     FROM products p LEFT JOIN stock st ON st.product_id = p.id AND st.store_id = ? LEFT JOIN suppliers sp ON sp.id = p.supplier_id
     WHERE p.is_active = 1 AND p.min_stock > 0 AND COALESCE(st.qty, 0) <= p.min_stock ${supplierId ? 'AND p.supplier_id = ?' : ''}
     ORDER BY sp.name, p.name`,
    storeId,
    storeId,
    ...(supplierId ? [supplierId] : []),
  );
  res.json(
    rows
      .map((r) => ({ ...r, suggested_qty: Math.max(0, Math.ceil(r.min_stock * 3 - r.stock - r.on_order)) }))
      .filter((r) => r.suggested_qty > 0),
  );
});

function loadPo(id: unknown) {
  const po = one<Record<string, any>>(
    `SELECT po.*, s.code AS store_code, s.name AS store_name, s.address AS store_address, sp.name AS supplier_name,
       sp.address AS supplier_address, sp.phone AS supplier_phone, sp.payment_terms,
       u.full_name AS created_by_name, a.full_name AS approved_by_name
     FROM purchase_orders po JOIN stores s ON s.id = po.store_id JOIN suppliers sp ON sp.id = po.supplier_id
     LEFT JOIN users u ON u.id = po.created_by LEFT JOIN users a ON a.id = po.approved_by WHERE po.id = ?`,
    id,
  );
  if (!po) throw notFound('PO tidak ditemukan');
  return po;
}

router.get('/:id', (req, res) => {
  const po = loadPo(req.params.id);
  assertStoreAccess(req, po.store_id);
  const items = all(
    `SELECT i.*, p.sku, p.name, p.unit FROM purchase_order_items i JOIN products p ON p.id = i.product_id WHERE i.po_id = ? ORDER BY i.id`,
    po.id,
  );
  res.json({ ...po, items });
});

const poSchema = z.object({
  store_id: z.number().int(),
  supplier_id: z.number().int(),
  expected_date: dateSchema.nullable().optional(),
  note: z.string().trim().optional(),
  items: z
    .array(z.object({ product_id: z.number().int(), qty: z.number().positive(), cost_price: z.number().int().min(0) }))
    .min(1, 'tambahkan minimal satu barang'),
});

function saveItems(poId: number, items: z.infer<typeof poSchema>['items']) {
  run('DELETE FROM purchase_order_items WHERE po_id = ?', poId);
  let total = 0;
  for (const i of items) {
    run('INSERT INTO purchase_order_items(po_id, product_id, qty, cost_price) VALUES (?, ?, ?, ?)', poId, i.product_id, i.qty, i.cost_price);
    total += Math.round(i.qty * i.cost_price);
  }
  run('UPDATE purchase_orders SET total = ? WHERE id = ?', total, poId);
}

router.post('/', requirePerm('purchasing.manage'), (req, res) => {
  const b = parse(poSchema, req.body);
  assertStoreAccess(req, b.store_id);
  const store = one<{ code: string }>('SELECT code FROM stores WHERE id = ?', b.store_id);
  if (!store) throw badRequest('Toko tidak valid');
  const id = tx(() => {
    const id = insert(
      'INSERT INTO purchase_orders(po_no, store_id, supplier_id, expected_date, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
      docNo('PO', store.code),
      b.store_id,
      b.supplier_id,
      b.expected_date ?? null,
      b.note ?? null,
      req.user!.id,
    );
    saveItems(id, b.items);
    return id;
  });
  audit(req, 'PO_CREATE', 'purchase_order', id, { supplier_id: b.supplier_id, items: b.items.length }, b.store_id);
  res.status(201).json({ id });
});

router.put('/:id', requirePerm('purchasing.manage'), (req, res) => {
  const b = parse(poSchema, req.body);
  const po = loadPo(req.params.id);
  assertStoreAccess(req, po.store_id);
  if (po.status !== 'DRAFT') throw conflict('Hanya PO berstatus Draft yang dapat diubah');
  tx(() => {
    run('UPDATE purchase_orders SET supplier_id = ?, expected_date = ?, note = ? WHERE id = ?', b.supplier_id, b.expected_date ?? null, b.note ?? null, po.id);
    saveItems(po.id, b.items);
  });
  audit(req, 'PO_UPDATE', 'purchase_order', po.id, { items: b.items.length }, po.store_id);
  res.json({ ok: true });
});

router.post('/:id/approve', requirePerm('purchasing.manage'), (req, res) => {
  if (!APPROVER_ROLES.includes(req.user!.role)) throw forbidden('PO hanya dapat disetujui Kepala Toko / Kantor Pusat');
  const po = loadPo(req.params.id);
  assertStoreAccess(req, po.store_id);
  if (po.status !== 'DRAFT') throw conflict('PO sudah diproses');
  run(`UPDATE purchase_orders SET status = 'APPROVED', approved_by = ?, approved_at = datetime('now','localtime') WHERE id = ?`, req.user!.id, po.id);
  audit(req, 'PO_APPROVE', 'purchase_order', po.id, { po_no: po.po_no, total: po.total }, po.store_id);
  res.json({ ok: true });
});

router.post('/:id/cancel', requirePerm('purchasing.manage'), (req, res) => {
  const po = loadPo(req.params.id);
  assertStoreAccess(req, po.store_id);
  if (!['DRAFT', 'APPROVED'].includes(po.status)) throw conflict('PO yang sudah diterima tidak dapat dibatalkan');
  run(`UPDATE purchase_orders SET status = 'CANCELLED' WHERE id = ?`, po.id);
  audit(req, 'PO_CANCEL', 'purchase_order', po.id, { po_no: po.po_no }, po.store_id);
  res.json({ ok: true });
});

export default router;
