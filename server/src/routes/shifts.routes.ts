import { Router } from 'express';
import { z } from 'zod';
import { can } from '../../../shared/permissions';
import { CASH_DENOMINATIONS } from '../../../shared/types';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { conflict, dateRange, forbidden, notFound, pagination, parse, qInt, qStr } from '../lib/http';
import { docNo } from '../lib/numbering';
import { activeSchedule, scheduleLabel, upcomingSchedules } from '../lib/schedules';
import { getSettings } from '../lib/settings';
import { approvalSchema, assertStoreAccess, requirePerm, scopedStoreId, verifyApproval } from '../middleware/auth';

const router = Router();

/** Ringkasan shift + perhitungan kas yang seharusnya ada di laci. */
export function shiftSummary(shiftId: number) {
  const shift = one<Record<string, any>>(
    `SELECT sh.*, u.full_name AS cashier_name, u.employee_no, t.code AS terminal_code, t.name AS terminal_name,
       st.code AS store_code, st.name AS store_name, ss.start_at AS schedule_start, ss.end_at AS schedule_end
     FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN terminals t ON t.id = sh.terminal_id JOIN stores st ON st.id = sh.store_id
     LEFT JOIN shift_schedules ss ON ss.id = sh.schedule_id
     WHERE sh.id = ?`,
    shiftId,
  );
  if (!shift) throw notFound('Shift tidak ditemukan');
  const sales = one<Record<string, number>>(
    `SELECT COUNT(*) AS trx_count, COALESCE(SUM(total), 0) AS sales_total, COALESCE(SUM(subtotal), 0) AS gross_total,
       COALESCE(SUM(discount_total), 0) AS discount_total, COALESCE(SUM(tax_amount), 0) AS tax_total,
       COALESCE(SUM(item_count), 0) AS item_count, COALESCE(SUM(change_amount), 0) AS change_total,
       SUM(member_id IS NOT NULL) AS member_trx
     FROM sales WHERE shift_id = ? AND status = 'COMPLETED'`,
    shiftId,
  )!;
  const voids = one<{ count: number; amount: number }>(
    `SELECT COUNT(*) AS count, COALESCE(SUM(total), 0) AS amount FROM sales WHERE shift_id = ? AND status = 'VOIDED'`,
    shiftId,
  )!;
  const returns = one<{ count: number; amount: number }>(
    'SELECT COUNT(*) AS count, COALESCE(SUM(total_refund), 0) AS amount FROM sale_returns WHERE shift_id = ?',
    shiftId,
  )!;
  const payments = all<{ method: string; count: number; amount: number }>(
    `SELECT sp.method, COUNT(*) AS count, SUM(sp.amount) AS amount FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.shift_id = ? AND s.status = 'COMPLETED' GROUP BY sp.method ORDER BY amount DESC`,
    shiftId,
  );
  // Tunai dicatat sebesar uang yang diserahkan; kembalian dikurangkan agar sesuai isi laci.
  const cashPayment = payments.find((p) => p.method === 'CASH');
  if (cashPayment) cashPayment.amount -= sales.change_total;
  const movements = all<Record<string, any>>(
    `SELECT cm.*, u.full_name AS user_name, a.full_name AS approver_name FROM cash_movements cm
     JOIN users u ON u.id = cm.user_id LEFT JOIN users a ON a.id = cm.approved_by WHERE cm.shift_id = ? ORDER BY cm.id`,
    shiftId,
  );
  const sumType = (t: string) => movements.filter((m) => m.type === t).reduce((s, m) => s + m.amount, 0);
  const cash = {
    opening: shift.opening_cash as number,
    sales: cashPayment?.amount ?? 0,
    cash_in: sumType('CASH_IN'),
    cash_out: sumType('CASH_OUT'),
    pickup: sumType('PICKUP'),
    refunds: returns.amount,
    expected: 0,
  };
  cash.expected = cash.opening + cash.sales + cash.cash_in - cash.cash_out - cash.pickup - cash.refunds;
  return { shift, sales, voids, returns, payments, movements, cash };
}

function loadShift(id: number) {
  const shift = one<Record<string, any>>('SELECT * FROM shifts WHERE id = ?', id);
  if (!shift) throw notFound('Shift tidak ditemukan');
  return shift;
}

router.get('/', requirePerm('shifts.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { start, end } = dateRange(req, 7);
  const storeId = scopedStoreId(req, req.query.store_id);
  const conds = ['sh.opened_at >= ?', 'sh.opened_at < ?'];
  const params: unknown[] = [start, end];
  if (storeId !== null) conds.push('sh.store_id = ?'), params.push(storeId);
  const status = qStr(req.query.status);
  if (status) conds.push('sh.status = ?'), params.push(status);
  const userId = qInt(req.query.user_id);
  if (userId) conds.push('sh.user_id = ?'), params.push(userId);
  const where = conds.join(' AND ');
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM shifts sh WHERE ${where}`, ...params)!.n;
  const data = all(
    `SELECT sh.*, u.full_name AS cashier_name, t.code AS terminal_code, st.code AS store_code,
       (SELECT COUNT(*) FROM sales s WHERE s.shift_id = sh.id AND s.status = 'COMPLETED') AS trx_count,
       (SELECT COALESCE(SUM(total), 0) FROM sales s WHERE s.shift_id = sh.id AND s.status = 'COMPLETED') AS sales_total
     FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN terminals t ON t.id = sh.terminal_id JOIN stores st ON st.id = sh.store_id
     WHERE ${where} ORDER BY sh.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total, page, limit });
});

router.post('/open', requirePerm('pos.use'), (req, res) => {
  const b = parse(z.object({ terminal_id: z.number().int(), opening_cash: z.number().int().min(0).optional() }), req.body);
  const terminal = one<{ id: number; store_id: number; code: string; is_active: number }>(
    'SELECT t.*, s.code AS store_code FROM terminals t JOIN stores s ON s.id = t.store_id WHERE t.id = ?',
    b.terminal_id,
  );
  if (!terminal || !terminal.is_active) throw notFound('Terminal tidak ditemukan / nonaktif');
  assertStoreAccess(req, terminal.store_id);
  const busy = one<{ full_name: string }>(
    `SELECT u.full_name FROM shifts sh JOIN users u ON u.id = sh.user_id WHERE sh.terminal_id = ? AND sh.status = 'OPEN'`,
    b.terminal_id,
  );
  if (busy) throw conflict(`Terminal masih dipakai oleh shift ${busy.full_name}. Tutup shift tersebut terlebih dahulu.`);
  const mine = one<{ terminal_code: string }>(
    `SELECT t.code AS terminal_code FROM shifts sh JOIN terminals t ON t.id = sh.terminal_id WHERE sh.user_id = ? AND sh.status = 'OPEN'`,
    req.user!.id,
  );
  if (mine) throw conflict(`Anda masih memiliki shift terbuka di ${mine.terminal_code}`);

  const settings = getSettings();
  const schedule = activeSchedule(req.user!.id, terminal.id);
  // Kasir wajib mengikuti jadwal; supervisor/kepala toko boleh membuka shift cadangan tanpa jadwal.
  if (!schedule && settings.enforce_schedule && req.user!.role === 'CASHIER') {
    const next = upcomingSchedules(req.user!.id, 1)[0];
    throw forbidden(
      `Anda tidak terjadwal di ${terminal.code} saat ini. ` +
        (next ? `Jadwal Anda: ${next.terminal_code} ${scheduleLabel(next.start_at, next.end_at)}.` : 'Hubungi kepala toko untuk jadwal shift.'),
    );
  }
  const openingCash = b.opening_cash ?? settings.opening_cash_default;
  const store = one<{ code: string }>('SELECT code FROM stores WHERE id = ?', terminal.store_id)!;
  const id = tx(() =>
    insert(
      'INSERT INTO shifts(shift_no, store_id, terminal_id, user_id, schedule_id, opening_cash) VALUES (?, ?, ?, ?, ?, ?)',
      docNo('SHF', store.code),
      terminal.store_id,
      terminal.id,
      req.user!.id,
      schedule?.id ?? null,
      openingCash,
    ),
  );
  audit(req, 'SHIFT_OPEN', 'shift', id, { terminal: terminal.code, opening_cash: openingCash, schedule_id: schedule?.id }, terminal.store_id);
  res.status(201).json(shiftSummary(id));
});

function assertShiftViewer(req: Parameters<typeof scopedStoreId>[0], shift: Record<string, any>) {
  assertStoreAccess(req, shift.store_id);
  if (shift.user_id !== req.user!.id && !can(req.user!.role, 'shifts.view')) throw forbidden();
}

router.get('/:id', (req, res) => {
  const shift = loadShift(Number(req.params.id));
  assertShiftViewer(req, shift);
  res.json(shiftSummary(shift.id));
});

router.post('/:id/cash', requirePerm('pos.use'), (req, res) => {
  const b = parse(
    z.object({
      type: z.enum(['CASH_IN', 'CASH_OUT', 'PICKUP']),
      amount: z.number().int().positive(),
      reason: z.string().trim().min(3, 'keterangan wajib diisi'),
      approval: approvalSchema,
    }),
    req.body,
  );
  const shift = loadShift(Number(req.params.id));
  if (shift.status !== 'OPEN') throw conflict('Shift sudah ditutup');
  if (shift.user_id !== req.user!.id) throw forbidden('Bukan shift Anda');
  const approver = verifyApproval(req, b.approval, shift.store_id, `CASH_${b.type}`);
  if (b.type !== 'CASH_IN') {
    const { cash } = shiftSummary(shift.id);
    if (b.amount > cash.expected) throw conflict('Nominal melebihi uang tunai di laci');
  }
  const id = insert(
    'INSERT INTO cash_movements(shift_id, type, amount, reason, user_id, approved_by) VALUES (?, ?, ?, ?, ?, ?)',
    shift.id,
    b.type,
    b.amount,
    b.reason,
    req.user!.id,
    approver.id,
  );
  audit(req, `SHIFT_${b.type}`, 'shift', shift.id, { amount: b.amount, reason: b.reason, approver: approver.username }, shift.store_id);
  res.status(201).json({ id, summary: shiftSummary(shift.id) });
});

router.post('/:id/close', requirePerm('pos.use', 'pos.approve'), (req, res) => {
  const b = parse(
    z.object({
      denominations: z.record(z.string(), z.number().int().min(0)),
      note: z.string().trim().max(300).optional(),
      approval: approvalSchema.optional(),
    }),
    req.body,
  );
  const shift = loadShift(Number(req.params.id));
  assertStoreAccess(req, shift.store_id);
  if (shift.status !== 'OPEN') throw conflict('Shift sudah ditutup');
  // Shift kasir lain (mis. kasir pergi tanpa tutup shift) dapat ditutup dengan otorisasi supervisor.
  let approver: string | undefined;
  if (shift.user_id !== req.user!.id && !can(req.user!.role, 'pos.approve')) {
    if (!b.approval) throw forbidden('Hanya pemilik shift atau supervisor yang dapat menutup shift');
    approver = verifyApproval(req, b.approval, shift.store_id, 'CLOSE_OTHER_SHIFT').username;
  }
  const counted = CASH_DENOMINATIONS.reduce((sum, d) => sum + d * (b.denominations[String(d)] ?? 0), 0);
  const { cash } = shiftSummary(shift.id);
  const variance = counted - cash.expected;
  run(
    `UPDATE shifts SET status = 'CLOSED', closed_at = datetime('now','localtime'), expected_cash = ?, counted_cash = ?,
       variance = ?, denominations = ?, closing_note = ? WHERE id = ?`,
    cash.expected,
    counted,
    variance,
    JSON.stringify(b.denominations),
    b.note ?? null,
    shift.id,
  );
  audit(req, 'SHIFT_CLOSE', 'shift', shift.id, { expected: cash.expected, counted, variance, approver }, shift.store_id);
  res.json(shiftSummary(shift.id));
});

export default router;
