import { Router } from 'express';
import { z } from 'zod';
import { parseScaleBarcode } from '../../../shared/barcode';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { badRequest, localDate, notFound, pagination, parse, qInt, qStr } from '../lib/http';
import { loadActivePromos } from '../lib/promos';
import { requirePerm, scopedStoreId } from '../middleware/auth';

const router = Router();

const PRODUCT_COLUMNS = `p.id, p.sku, p.barcode, p.plu_code, p.name, p.short_name, p.brand, p.category_id, p.supplier_id,
  p.unit, p.cost_price, p.sell_price, p.tax_type, p.is_weighted, p.min_stock, p.is_active, p.created_at, p.updated_at,
  c.name AS category_name, sp.name AS supplier_name`;

/** Subquery stok: per toko, atau total semua toko bila storeId null. */
function stockExpr(storeId: number | null) {
  return storeId === null
    ? '(SELECT COALESCE(SUM(qty), 0) FROM stock st WHERE st.product_id = p.id)'
    : '(SELECT COALESCE(qty, 0) FROM stock st WHERE st.product_id = p.id AND st.store_id = ?)';
}

router.get('/', requirePerm('products.view', 'pos.use'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const storeId = scopedStoreId(req, req.query.store_id);
  const q = qStr(req.query.q);
  const status = qStr(req.query.status) ?? 'active';
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status !== 'all') conds.push('p.is_active = ?'), params.push(status === 'active' ? 1 : 0);
  if (q) {
    conds.push('(p.name LIKE ? OR p.sku = ? OR p.barcode = ? OR p.plu_code = ? OR p.brand LIKE ?)');
    params.push(`%${q}%`, q, q, q, `%${q}%`);
  }
  const categoryId = qInt(req.query.category_id);
  if (categoryId) conds.push('p.category_id = ?'), params.push(categoryId);
  const supplierId = qInt(req.query.supplier_id);
  if (supplierId) conds.push('p.supplier_id = ?'), params.push(supplierId);
  const stockParams = storeId === null ? [] : [storeId];
  if (req.query.low_stock === '1') conds.push(`${stockExpr(storeId)} <= p.min_stock`), params.push(...stockParams);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM products p ${where}`, ...params)!.n;
  const data = all(
    `SELECT ${PRODUCT_COLUMNS}, ${stockExpr(storeId)} AS stock
     FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers sp ON sp.id = p.supplier_id
     ${where} ORDER BY p.name LIMIT ? OFFSET ?`,
    ...stockParams,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total, page, limit });
});

/** Lookup cepat untuk kasir: barcode, SKU, PLU, atau barcode timbangan. */
router.get('/lookup', requirePerm('pos.use', 'products.view'), (req, res) => {
  const code = qStr(req.query.code);
  if (!code) throw badRequest('Kode wajib diisi');
  const storeId = scopedStoreId(req, req.query.store_id);
  const stockParams = storeId === null ? [] : [storeId];
  const base = `SELECT ${PRODUCT_COLUMNS}, ${stockExpr(storeId)} AS stock
    FROM products p LEFT JOIN categories c ON c.id = p.category_id LEFT JOIN suppliers sp ON sp.id = p.supplier_id
    WHERE p.is_active = 1 AND`;

  const scale = parseScaleBarcode(code);
  if (scale) {
    const product = one(`${base} p.plu_code = ? AND p.is_weighted = 1`, ...stockParams, scale.plu);
    if (!product) throw notFound(`PLU timbangan ${scale.plu} tidak terdaftar`);
    return res.json({ product, qty: scale.weightKg });
  }
  const product =
    one(`${base} p.barcode = ?`, ...stockParams, code) ??
    one(`${base} p.sku = ?`, ...stockParams, code) ??
    one(`${base} p.plu_code = ?`, ...stockParams, code);
  if (!product) throw notFound(`Barang dengan kode "${code}" tidak ditemukan`);
  res.json({ product, qty: null });
});

router.get('/:id', requirePerm('products.view', 'pos.use'), (req, res) => {
  const product = one(
    `SELECT ${PRODUCT_COLUMNS} FROM products p LEFT JOIN categories c ON c.id = p.category_id
     LEFT JOIN suppliers sp ON sp.id = p.supplier_id WHERE p.id = ?`,
    req.params.id,
  );
  if (!product) throw notFound('Produk tidak ditemukan');
  const storeId = scopedStoreId(req, req.query.store_id);
  const stocks = all(
    `SELECT s.id AS store_id, s.code, s.name, COALESCE(st.qty, 0) AS qty, st.updated_at
     FROM stores s LEFT JOIN stock st ON st.store_id = s.id AND st.product_id = ?
     WHERE s.is_active = 1 ${storeId !== null ? 'AND s.id = ?' : ''} ORDER BY s.code`,
    req.params.id,
    ...(storeId !== null ? [storeId] : []),
  );
  const promos = (storeId ? loadActivePromos(storeId, localDate()) : []).filter((p) =>
    p.targetIds.includes(p.scope === 'PRODUCT' ? product.id : product.category_id),
  );
  const sales30d = one(
    `SELECT COALESCE(SUM(si.qty - si.returned_qty), 0) AS qty, COALESCE(SUM(si.net), 0) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE si.product_id = ? AND s.status = 'COMPLETED' AND s.created_at >= datetime('now','localtime','-30 days')
     ${storeId !== null ? 'AND s.store_id = ?' : ''}`,
    req.params.id,
    ...(storeId !== null ? [storeId] : []),
  );
  res.json({ ...product, stocks, promos, sales30d });
});

const productSchema = z.object({
  sku: z.string().trim().min(3).max(20),
  barcode: z
    .string()
    .trim()
    .regex(/^\d{8,14}$/, 'barcode harus 8–14 digit angka')
    .nullable()
    .optional()
    .or(z.literal('')),
  plu_code: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'PLU harus 5 digit')
    .nullable()
    .optional()
    .or(z.literal('')),
  name: z.string().trim().min(2).max(120),
  short_name: z.string().trim().max(24).nullable().optional(),
  brand: z.string().trim().max(60).nullable().optional(),
  category_id: z.number().int().nullable(),
  supplier_id: z.number().int().nullable(),
  unit: z.string().trim().min(1).max(10).toUpperCase(),
  cost_price: z.number().int().min(0),
  sell_price: z.number().int().min(1, 'harga jual wajib diisi'),
  tax_type: z.enum(['PPN', 'NON_PPN']),
  is_weighted: z.boolean(),
  min_stock: z.number().min(0),
  is_active: z.boolean().optional(),
});

function productValues(b: z.infer<typeof productSchema>) {
  if (b.is_weighted && !b.plu_code) throw badRequest('Barang timbang wajib memiliki kode PLU 5 digit');
  return [
    b.sku.toUpperCase(),
    b.barcode || null,
    b.plu_code || null,
    b.name,
    b.short_name || null,
    b.brand || null,
    b.category_id,
    b.supplier_id,
    b.unit,
    b.cost_price,
    b.sell_price,
    b.tax_type,
    b.is_weighted ? 1 : 0,
    b.min_stock,
  ];
}

router.post('/', requirePerm('products.manage'), (req, res) => {
  const b = parse(productSchema, req.body);
  const id = insert(
    `INSERT INTO products(sku, barcode, plu_code, name, short_name, brand, category_id, supplier_id, unit, cost_price,
       sell_price, tax_type, is_weighted, min_stock) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ...productValues(b),
  );
  audit(req, 'PRODUCT_CREATE', 'product', id, { sku: b.sku, name: b.name, sell_price: b.sell_price });
  res.status(201).json({ id });
});

router.put('/:id', requirePerm('products.manage'), (req, res) => {
  const b = parse(productSchema, req.body);
  const before = one<{ sell_price: number; cost_price: number }>('SELECT sell_price, cost_price FROM products WHERE id = ?', req.params.id);
  if (!before) throw notFound('Produk tidak ditemukan');
  run(
    `UPDATE products SET sku=?, barcode=?, plu_code=?, name=?, short_name=?, brand=?, category_id=?, supplier_id=?, unit=?,
       cost_price=?, sell_price=?, tax_type=?, is_weighted=?, min_stock=?, is_active=?, updated_at=datetime('now','localtime')
     WHERE id=?`,
    ...productValues(b),
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  const details: Record<string, unknown> = { sku: b.sku, name: b.name };
  if (before.sell_price !== b.sell_price) details.sell_price = { from: before.sell_price, to: b.sell_price };
  if (before.cost_price !== b.cost_price) details.cost_price = { from: before.cost_price, to: b.cost_price };
  audit(req, details.sell_price ? 'PRICE_CHANGE' : 'PRODUCT_UPDATE', 'product', Number(req.params.id), details);
  res.json({ ok: true });
});

/** Impor massal (upsert berdasarkan SKU) dari file CSV yang sudah di-parse client. */
router.post('/import', requirePerm('products.manage'), (req, res) => {
  const rows = parse(
    z
      .array(
        z.object({
          sku: z.string().trim().min(3),
          barcode: z.string().trim().optional(),
          name: z.string().trim().min(2),
          category_code: z.string().trim().optional(),
          unit: z.string().trim().optional(),
          cost_price: z.coerce.number().int().min(0),
          sell_price: z.coerce.number().int().min(1),
          tax_type: z.enum(['PPN', 'NON_PPN']).optional(),
          min_stock: z.coerce.number().min(0).optional(),
        }),
      )
      .min(1)
      .max(5000),
    req.body.rows,
  );
  const categories = new Map(all<{ id: number; code: string }>('SELECT id, code FROM categories').map((c) => [c.code, c.id]));
  let created = 0;
  let updated = 0;
  tx(() => {
    for (const r of rows) {
      const categoryId = r.category_code ? (categories.get(r.category_code.toUpperCase()) ?? null) : null;
      const existing = one<{ id: number }>('SELECT id FROM products WHERE sku = ?', r.sku.toUpperCase());
      if (existing) {
        run(
          `UPDATE products SET barcode=COALESCE(?, barcode), name=?, category_id=COALESCE(?, category_id), unit=COALESCE(?, unit),
             cost_price=?, sell_price=?, tax_type=COALESCE(?, tax_type), min_stock=COALESCE(?, min_stock),
             updated_at=datetime('now','localtime') WHERE id=?`,
          r.barcode || null,
          r.name,
          categoryId,
          r.unit?.toUpperCase() || null,
          r.cost_price,
          r.sell_price,
          r.tax_type ?? null,
          r.min_stock ?? null,
          existing.id,
        );
        updated++;
      } else {
        run(
          `INSERT INTO products(sku, barcode, name, category_id, unit, cost_price, sell_price, tax_type, min_stock)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          r.sku.toUpperCase(),
          r.barcode || null,
          r.name,
          categoryId,
          r.unit?.toUpperCase() || 'PCS',
          r.cost_price,
          r.sell_price,
          r.tax_type ?? 'PPN',
          r.min_stock ?? 0,
        );
        created++;
      }
    }
  });
  audit(req, 'PRODUCT_IMPORT', 'product', null, { created, updated });
  res.json({ created, updated });
});

export default router;
