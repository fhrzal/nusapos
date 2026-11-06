import { Router } from 'express';
import { z } from 'zod';
import { all, insert, one, run } from '../db';
import { audit } from '../lib/audit';
import { can } from '../../../shared/permissions';
import { forbidden, localDate, localDateTime, notFound, parse, qInt, qStr } from '../lib/http';
import { activeSchedule, upcomingSchedules } from '../lib/schedules';
import { loadActivePromos } from '../lib/promos';
import { getSettings } from '../lib/settings';
import { assertStoreAccess, isHq, requirePerm } from '../middleware/auth';
import { shiftSummary } from './shifts.routes';

const router = Router();
router.use(requirePerm('pos.use'));

/** Daftar terminal yang dapat dipakai user beserta status shift-nya. */
router.get('/terminals', (req, res) => {
  res.json(
    all(
      `SELECT t.id, t.code, t.name, t.store_id, s.code AS store_code, s.name AS store_name,
         sh.id AS open_shift_id, u.full_name AS open_shift_user, sh.user_id AS open_shift_user_id,
         (SELECT ss.start_at || '|' || ss.end_at FROM shift_schedules ss WHERE ss.terminal_id = t.id AND ss.user_id = ?
            AND ss.end_at > ? ORDER BY ss.start_at LIMIT 1) AS my_schedule
       FROM terminals t JOIN stores s ON s.id = t.store_id
       LEFT JOIN shifts sh ON sh.terminal_id = t.id AND sh.status = 'OPEN' LEFT JOIN users u ON u.id = sh.user_id
       WHERE t.is_active = 1 AND s.is_active = 1 ${isHq(req) ? '' : 'AND t.store_id = ?'}
       ORDER BY s.code, t.code`,
      req.user!.id,
      localDateTime(),
      ...(isHq(req) ? [] : [req.user!.store_id]),
    ),
  );
});

/** Data awal layar kasir: terminal, toko, shift aktif, pengaturan, promo berjalan. */
router.get('/bootstrap', (req, res) => {
  const terminalId = qInt(req.query.terminal_id);
  const terminal = one<Record<string, any>>(
    `SELECT t.*, s.code AS store_code, s.name AS store_name, s.address AS store_address, s.phone AS store_phone, s.city AS store_city
     FROM terminals t JOIN stores s ON s.id = t.store_id WHERE t.id = ? AND t.is_active = 1`,
    terminalId,
  );
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  const open = one<{ id: number }>(`SELECT id FROM shifts WHERE terminal_id = ? AND status = 'OPEN'`, terminal.id);
  res.json({
    terminal,
    shift: open ? shiftSummary(open.id) : null,
    settings: getSettings(),
    promos: loadActivePromos(terminal.store_id, localDate()),
    held_count: one<{ n: number }>('SELECT COUNT(*) n FROM held_carts WHERE store_id = ?', terminal.store_id)!.n,
    // Jadwal: milik user di terminal ini sekarang, antrean jadwal terminal, dan jadwal user berikutnya.
    my_schedule: activeSchedule(req.user!.id, terminal.id) ?? null,
    schedules: all(
      `SELECT ss.id, ss.user_id, ss.start_at, ss.end_at, u.full_name, u.username FROM shift_schedules ss
       JOIN users u ON u.id = ss.user_id WHERE ss.terminal_id = ? AND ss.end_at > ? ORDER BY ss.start_at LIMIT 4`,
      terminal.id,
      localDateTime(),
    ),
    my_upcoming: upcomingSchedules(req.user!.id),
  });
});

/** Katalog ringkas toko untuk pencarian & scan instan di kasir (tanpa harga beli). */
router.get('/catalog', (req, res) => {
  const terminal = one<{ store_id: number }>('SELECT store_id FROM terminals WHERE id = ?', qInt(req.query.terminal_id));
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  const ids = (qStr(req.query.ids) ?? '')
    .split(',')
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  res.json(
    all(
      `SELECT p.id, p.sku, p.barcode, p.plu_code, p.name, p.brand, p.unit, p.sell_price, p.category_id, c.name AS category_name,
         p.tax_type, p.is_weighted, p.min_stock, COALESCE(st.qty, 0) AS stock
       FROM products p LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock st ON st.product_id = p.id AND st.store_id = ?
       WHERE p.is_active = 1 ${ids.length ? `AND p.id IN (${ids.map(() => '?').join(',')})` : ''}
       ORDER BY p.name`,
      terminal.store_id,
      ...ids,
    ),
  );
});

/** Riwayat transaksi untuk layar kasir: shift berjalan atau terminal hari ini. */
router.get('/history', (req, res) => {
  const terminal = one<{ id: number; store_id: number }>('SELECT id, store_id FROM terminals WHERE id = ?', qInt(req.query.terminal_id));
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (qStr(req.query.scope) === 'terminal') {
    conds.push('s.terminal_id = ?', 's.created_at >= ?');
    params.push(terminal.id, `${localDate()} 00:00:00`);
  } else {
    const shift = one<{ id: number; user_id: number; terminal_id: number }>('SELECT id, user_id, terminal_id FROM shifts WHERE id = ?', qInt(req.query.shift_id));
    if (!shift || shift.terminal_id !== terminal.id) throw notFound('Shift tidak ditemukan');
    if (shift.user_id !== req.user!.id && !can(req.user!.role, 'pos.approve')) throw forbidden();
    conds.push('s.shift_id = ?');
    params.push(shift.id);
  }
  const q = qStr(req.query.q);
  if (q) conds.push('(s.receipt_no LIKE ? OR m.name LIKE ? OR m.member_no = ?)'), params.push(`%${q}%`, `%${q}%`, q);
  const where = conds.join(' AND ');
  const rows = all(
    `SELECT s.id, s.receipt_no, s.created_at, s.total, s.item_count, s.status, s.shift_id, s.discount_total,
       u.full_name AS cashier_name, m.name AS member_name,
       (SELECT GROUP_CONCAT(DISTINCT sp.method) FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods,
       (SELECT COUNT(*) FROM sale_returns r WHERE r.sale_id = s.id) AS return_count
     FROM sales s JOIN users u ON u.id = s.cashier_id LEFT JOIN members m ON m.id = s.member_id
     WHERE ${where} ORDER BY s.id DESC LIMIT 300`,
    ...params,
  );
  const summary = one(
    `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN s.status = 'COMPLETED' THEN s.total END), 0) AS total,
       COALESCE(SUM(s.status = 'VOIDED'), 0) AS voided
     FROM sales s LEFT JOIN members m ON m.id = s.member_id WHERE ${where}`,
    ...params,
  );
  res.json({ rows, summary });
});

// ---------------------------------------------------------------- Transaksi tertunda (hold / recall)
router.get('/held', (req, res) => {
  const terminal = one<{ store_id: number }>('SELECT store_id FROM terminals WHERE id = ?', qInt(req.query.terminal_id));
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  res.json(
    all(
      `SELECT h.id, h.label, h.created_at, h.data, t.code AS terminal_code, u.full_name AS user_name
       FROM held_carts h JOIN terminals t ON t.id = h.terminal_id JOIN users u ON u.id = h.user_id
       WHERE h.store_id = ? ORDER BY h.id DESC`,
      terminal.store_id,
    ).map((h) => ({ ...h, data: JSON.parse(h.data) })),
  );
});

router.post('/held', (req, res) => {
  const b = parse(
    z.object({ terminal_id: z.number().int(), label: z.string().trim().max(40).optional(), data: z.record(z.unknown()) }),
    req.body,
  );
  const terminal = one<{ store_id: number }>('SELECT store_id FROM terminals WHERE id = ?', b.terminal_id);
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  const id = insert(
    'INSERT INTO held_carts(store_id, terminal_id, user_id, label, data) VALUES (?, ?, ?, ?, ?)',
    terminal.store_id,
    b.terminal_id,
    req.user!.id,
    b.label ?? null,
    JSON.stringify(b.data),
  );
  audit(req, 'CART_HOLD', 'held_cart', id, { label: b.label }, terminal.store_id);
  res.status(201).json({ id });
});

router.post('/held/:id/recall', (req, res) => {
  const held = one<Record<string, any>>('SELECT * FROM held_carts WHERE id = ?', req.params.id);
  if (!held) throw notFound('Transaksi tertunda sudah dipanggil / tidak ada');
  assertStoreAccess(req, held.store_id);
  run('DELETE FROM held_carts WHERE id = ?', held.id);
  audit(req, 'CART_RECALL', 'held_cart', held.id, { label: held.label }, held.store_id);
  res.json({ ...held, data: JSON.parse(held.data) });
});

export default router;
