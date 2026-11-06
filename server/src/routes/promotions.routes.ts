import { Router } from 'express';
import { z } from 'zod';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { badRequest, dateSchema, localDate, notFound, parse, qStr } from '../lib/http';
import { requirePerm } from '../middleware/auth';

const router = Router();

router.get('/', requirePerm('promotions.manage', 'products.view'), (req, res) => {
  const status = qStr(req.query.status) ?? 'all';
  const today = localDate();
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status === 'running') conds.push('p.is_active = 1 AND p.start_date <= ? AND p.end_date >= ?'), params.push(today, today);
  if (status === 'scheduled') conds.push('p.is_active = 1 AND p.start_date > ?'), params.push(today);
  if (status === 'ended') conds.push('(p.end_date < ? OR p.is_active = 0)'), params.push(today);
  const rows = all(
    `SELECT p.*, s.code AS store_code, s.name AS store_name,
       (SELECT COUNT(*) FROM promotion_targets t WHERE t.promotion_id = p.id) AS target_count,
       (SELECT COUNT(DISTINCT si.sale_id) FROM sale_items si WHERE si.promo_id = p.id) AS usage_count,
       (SELECT COALESCE(SUM(si.discount), 0) FROM sale_items si JOIN sales sa ON sa.id = si.sale_id
          WHERE si.promo_id = p.id AND sa.status = 'COMPLETED') AS discount_given
     FROM promotions p LEFT JOIN stores s ON s.id = p.store_id
     ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''}
     ORDER BY p.is_active DESC, p.end_date DESC, p.id DESC`,
    ...params,
  );
  res.json(rows);
});

router.get('/:id', requirePerm('promotions.manage', 'products.view'), (req, res) => {
  const promo = one<Record<string, any>>('SELECT * FROM promotions WHERE id = ?', req.params.id);
  if (!promo) throw notFound('Promo tidak ditemukan');
  const targets =
    promo.scope === 'PRODUCT'
      ? all(
          `SELECT p.id, p.sku, p.name, p.sell_price, p.unit FROM promotion_targets t JOIN products p ON p.id = t.target_id
           WHERE t.promotion_id = ? ORDER BY p.name`,
          req.params.id,
        )
      : all(
          `SELECT c.id, c.code AS sku, c.name FROM promotion_targets t JOIN categories c ON c.id = t.target_id
           WHERE t.promotion_id = ? ORDER BY c.name`,
          req.params.id,
        );
  res.json({ ...promo, targets });
});

const promoSchema = z
  .object({
    code: z.string().trim().min(3).max(20).toUpperCase(),
    name: z.string().trim().min(3).max(60),
    description: z.string().trim().optional().nullable(),
    type: z.enum(['PERCENT', 'AMOUNT', 'SPECIAL_PRICE', 'BUY_X_GET_Y', 'BUNDLE_PRICE']),
    value: z.number().min(0),
    buy_qty: z.number().int().min(1).nullable().optional(),
    get_qty: z.number().int().min(1).nullable().optional(),
    min_qty: z.number().min(0.001).default(1),
    scope: z.enum(['PRODUCT', 'CATEGORY']),
    target_ids: z.array(z.number().int()).min(1, 'pilih minimal satu produk/kategori'),
    member_only: z.boolean(),
    store_id: z.number().int().nullable(),
    start_date: dateSchema,
    end_date: dateSchema,
    is_active: z.boolean().optional(),
  })
  .superRefine((b, ctx) => {
    const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (b.end_date < b.start_date) fail('Tanggal selesai harus setelah tanggal mulai');
    if (b.type === 'PERCENT' && (b.value <= 0 || b.value > 100)) fail('Diskon persen harus antara 1–100');
    if (b.type === 'BUY_X_GET_Y' && (!b.buy_qty || !b.get_qty)) fail('Isi jumlah beli dan jumlah gratis');
    if (b.type === 'BUNDLE_PRICE' && (!b.buy_qty || b.buy_qty < 2)) fail('Harga paket minimal untuk 2 pcs');
    if (['AMOUNT', 'SPECIAL_PRICE', 'BUNDLE_PRICE'].includes(b.type) && b.value <= 0) fail('Nilai promo wajib diisi');
  });

function saveTargets(promoId: number, ids: number[]) {
  run('DELETE FROM promotion_targets WHERE promotion_id = ?', promoId);
  for (const id of new Set(ids)) run('INSERT INTO promotion_targets(promotion_id, target_id) VALUES (?, ?)', promoId, id);
}

function values(b: z.infer<typeof promoSchema>) {
  const usesQty = b.type === 'BUY_X_GET_Y' || b.type === 'BUNDLE_PRICE';
  return [
    b.code,
    b.name,
    b.description ?? null,
    b.type,
    b.type === 'BUY_X_GET_Y' ? 0 : b.value,
    usesQty ? b.buy_qty : null,
    b.type === 'BUY_X_GET_Y' ? b.get_qty : null,
    b.min_qty,
    b.scope,
    b.member_only ? 1 : 0,
    b.store_id,
    b.start_date,
    b.end_date,
  ];
}

router.post('/', requirePerm('promotions.manage'), (req, res) => {
  const b = parse(promoSchema, req.body);
  const id = tx(() => {
    const id = insert(
      `INSERT INTO promotions(code, name, description, type, value, buy_qty, get_qty, min_qty, scope, member_only, store_id,
         start_date, end_date, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ...values(b),
      req.user!.id,
    );
    saveTargets(id, b.target_ids);
    return id;
  });
  audit(req, 'PROMO_CREATE', 'promotion', id, { code: b.code, name: b.name, type: b.type, value: b.value });
  res.status(201).json({ id });
});

router.put('/:id', requirePerm('promotions.manage'), (req, res) => {
  const b = parse(promoSchema, req.body);
  if (!one('SELECT 1 FROM promotions WHERE id = ?', req.params.id)) throw notFound('Promo tidak ditemukan');
  tx(() => {
    run(
      `UPDATE promotions SET code=?, name=?, description=?, type=?, value=?, buy_qty=?, get_qty=?, min_qty=?, scope=?,
         member_only=?, store_id=?, start_date=?, end_date=?, is_active=? WHERE id=?`,
      ...values(b),
      b.is_active === false ? 0 : 1,
      req.params.id,
    );
    saveTargets(Number(req.params.id), b.target_ids);
  });
  audit(req, 'PROMO_UPDATE', 'promotion', Number(req.params.id), { code: b.code, is_active: b.is_active });
  res.json({ ok: true });
});

router.post('/:id/toggle', requirePerm('promotions.manage'), (req, res) => {
  const promo = one<{ is_active: number; code: string }>('SELECT is_active, code FROM promotions WHERE id = ?', req.params.id);
  if (!promo) throw badRequest('Promo tidak ditemukan');
  run('UPDATE promotions SET is_active = ? WHERE id = ?', promo.is_active ? 0 : 1, req.params.id);
  audit(req, promo.is_active ? 'PROMO_DEACTIVATE' : 'PROMO_ACTIVATE', 'promotion', Number(req.params.id), { code: promo.code });
  res.json({ is_active: !promo.is_active });
});

export default router;
