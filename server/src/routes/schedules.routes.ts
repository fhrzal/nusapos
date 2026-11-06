import type { Request } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { all, insert, one, run, tx } from '../db';
import { audit } from '../lib/audit';
import { addDays, badRequest, conflict, dateSchema, localDate, notFound, parse, qStr } from '../lib/http';
import { scheduleLabel } from '../lib/schedules';
import { assertStoreAccess, requirePerm, requireStoreId } from '../middleware/auth';

const router = Router();

const POS_ROLES = ['CASHIER', 'SUPERVISOR', 'STORE_MANAGER'];
const MAX_HOURS = 16;

router.get('/', requirePerm('schedules.manage', 'shifts.view'), (req, res) => {
  const storeId = requireStoreId(req, req.query.store_id);
  const from = qStr(req.query.from) ?? localDate();
  const to = qStr(req.query.to) ?? addDays(from, 6);
  if (!dateSchema.safeParse(from).success || !dateSchema.safeParse(to).success) throw badRequest('Format tanggal tidak valid');
  res.json(
    all(
      `SELECT ss.*, u.full_name, u.username, u.employee_no, u.role, t.code AS terminal_code,
         sh.id AS shift_id, sh.status AS shift_status, sh.opened_at, sh.closed_at
       FROM shift_schedules ss JOIN users u ON u.id = ss.user_id JOIN terminals t ON t.id = ss.terminal_id
       LEFT JOIN shifts sh ON sh.id = (SELECT MAX(id) FROM shifts WHERE schedule_id = ss.id)
       WHERE ss.store_id = ? AND ss.start_at < ? AND ss.end_at > ?
       ORDER BY ss.start_at, t.code`,
      storeId,
      `${addDays(to, 1)} 00:00:00`,
      `${from} 00:00:00`,
    ),
  );
});

router.get('/options', requirePerm('schedules.manage'), (req, res) => {
  const storeId = requireStoreId(req, req.query.store_id);
  res.json({
    terminals: all('SELECT id, code, name FROM terminals WHERE store_id = ? AND is_active = 1 ORDER BY code', storeId),
    users: all(
      `SELECT id, full_name, username, employee_no, role FROM users
       WHERE store_id = ? AND is_active = 1 AND role IN ('CASHIER','SUPERVISOR','STORE_MANAGER')
       ORDER BY role = 'CASHIER' DESC, full_name`,
      storeId,
    ),
  });
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'format jam HH:MM');
const scheduleSchema = z.object({
  terminal_id: z.number().int(),
  user_id: z.number().int(),
  dates: z.array(dateSchema).min(1, 'pilih minimal satu tanggal').max(31),
  start_time: time,
  end_time: time,
  note: z.string().trim().max(100).optional().nullable(),
});

/** Jam selesai ≤ jam mulai berarti shift melewati tengah malam. */
function toRange(date: string, start: string, end: string) {
  return { start_at: `${date} ${start}:00`, end_at: `${end <= start ? addDays(date, 1) : date} ${end}:00` };
}

const hoursBetween = (a: string, b: string) => (new Date(b.replace(' ', 'T')).getTime() - new Date(a.replace(' ', 'T')).getTime()) / 3_600_000;

/** Tolak jadwal yang tumpang tindih di terminal yang sama atau untuk petugas yang sama. */
function checkConflicts(terminalId: number, userId: number, start: string, end: string, excludeId = 0) {
  const overlap = (col: 'terminal_id' | 'user_id', id: number) =>
    one<{ full_name: string; code: string; start_at: string; end_at: string }>(
      `SELECT u.full_name, t.code, ss.start_at, ss.end_at FROM shift_schedules ss
       JOIN users u ON u.id = ss.user_id JOIN terminals t ON t.id = ss.terminal_id
       WHERE ss.${col} = ? AND ss.start_at < ? AND ss.end_at > ? AND ss.id != ? LIMIT 1`,
      id,
      end,
      start,
      excludeId,
    );
  const t = overlap('terminal_id', terminalId);
  if (t) throw conflict(`${t.code} sudah dijadwalkan untuk ${t.full_name} pada ${scheduleLabel(t.start_at, t.end_at)}`);
  const u = overlap('user_id', userId);
  if (u) throw conflict(`${u.full_name} sudah terjadwal di ${u.code} pada ${scheduleLabel(u.start_at, u.end_at)}`);
}

function validate(req: Request, b: z.infer<typeof scheduleSchema>, excludeId = 0) {
  const terminal = one<{ id: number; store_id: number; code: string }>('SELECT id, store_id, code FROM terminals WHERE id = ? AND is_active = 1', b.terminal_id);
  if (!terminal) throw notFound('Terminal tidak ditemukan');
  assertStoreAccess(req, terminal.store_id);
  const user = one<{ store_id: number; role: string }>('SELECT store_id, role FROM users WHERE id = ? AND is_active = 1', b.user_id);
  if (!user || user.store_id !== terminal.store_id || !POS_ROLES.includes(user.role)) throw badRequest('Petugas tidak valid untuk toko ini');
  return [...new Set(b.dates)].sort().map((date) => {
    const range = toRange(date, b.start_time, b.end_time);
    if (hoursBetween(range.start_at, range.end_at) > MAX_HOURS) throw badRequest(`Durasi shift maksimal ${MAX_HOURS} jam`);
    checkConflicts(terminal.id, b.user_id, range.start_at, range.end_at, excludeId);
    return { ...range, store_id: terminal.store_id };
  });
}

router.post('/', requirePerm('schedules.manage'), (req, res) => {
  const b = parse(scheduleSchema, req.body);
  const ids = tx(() =>
    validate(req, b).map((e) =>
      insert(
        'INSERT INTO shift_schedules(store_id, terminal_id, user_id, start_at, end_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        e.store_id,
        b.terminal_id,
        b.user_id,
        e.start_at,
        e.end_at,
        b.note || null,
        req.user!.id,
      ),
    ),
  );
  audit(req, 'SCHEDULE_CREATE', 'schedule', ids[0], { terminal_id: b.terminal_id, user_id: b.user_id, dates: b.dates, time: `${b.start_time}-${b.end_time}` });
  res.status(201).json({ ids });
});

function loadSchedule(req: Request) {
  const s = one<Record<string, any>>(
    'SELECT ss.*, (SELECT COUNT(*) FROM shifts sh WHERE sh.schedule_id = ss.id) AS shift_count FROM shift_schedules ss WHERE ss.id = ?',
    req.params.id,
  );
  if (!s) throw notFound('Jadwal tidak ditemukan');
  assertStoreAccess(req, s.store_id);
  return s;
}

router.put('/:id', requirePerm('schedules.manage'), (req, res) => {
  const b = parse(scheduleSchema, req.body);
  if (b.dates.length !== 1) throw badRequest('Ubah jadwal hanya untuk satu tanggal');
  const s = loadSchedule(req);
  if (s.shift_count && (s.user_id !== b.user_id || s.terminal_id !== b.terminal_id)) throw conflict('Shift dari jadwal ini sudah dibuka; petugas dan terminal tidak dapat diganti');
  const [e] = validate(req, b, s.id);
  run('UPDATE shift_schedules SET terminal_id = ?, user_id = ?, start_at = ?, end_at = ?, note = ? WHERE id = ?', b.terminal_id, b.user_id, e.start_at, e.end_at, b.note || null, s.id);
  audit(req, 'SCHEDULE_UPDATE', 'schedule', s.id, { user_id: b.user_id, start_at: e.start_at, end_at: e.end_at });
  res.json({ ok: true });
});

router.delete('/:id', requirePerm('schedules.manage'), (req, res) => {
  const s = loadSchedule(req);
  if (s.shift_count) throw conflict('Shift dari jadwal ini sudah dibuka sehingga jadwal tidak dapat dihapus');
  run('DELETE FROM shift_schedules WHERE id = ?', s.id);
  audit(req, 'SCHEDULE_DELETE', 'schedule', s.id, { user_id: s.user_id, start_at: s.start_at });
  res.json({ ok: true });
});

/** Salin seluruh jadwal satu minggu ke minggu lain; jadwal yang bentrok dilewati. */
router.post('/copy-week', requirePerm('schedules.manage'), (req, res) => {
  const b = parse(z.object({ store_id: z.number().int(), from: dateSchema, to: dateSchema }), req.body);
  assertStoreAccess(req, b.store_id);
  const diff = Math.round((new Date(`${b.to}T00:00:00`).getTime() - new Date(`${b.from}T00:00:00`).getTime()) / 86_400_000);
  if (diff === 0) throw badRequest('Minggu asal dan tujuan sama');
  const source = all<Record<string, any>>(
    `SELECT ss.* FROM shift_schedules ss JOIN users u ON u.id = ss.user_id JOIN terminals t ON t.id = ss.terminal_id
     WHERE ss.store_id = ? AND ss.start_at >= ? AND ss.start_at < ? AND u.is_active = 1 AND t.is_active = 1`,
    b.store_id,
    `${b.from} 00:00:00`,
    `${addDays(b.from, 7)} 00:00:00`,
  );
  const shift = (dt: string) => `${addDays(dt.slice(0, 10), diff)}${dt.slice(10)}`;
  let created = 0;
  tx(() => {
    for (const s of source) {
      const start = shift(s.start_at);
      const end = shift(s.end_at);
      try {
        checkConflicts(s.terminal_id, s.user_id, start, end);
      } catch {
        continue;
      }
      run(
        'INSERT INTO shift_schedules(store_id, terminal_id, user_id, start_at, end_at, note, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
        s.store_id,
        s.terminal_id,
        s.user_id,
        start,
        end,
        s.note,
        req.user!.id,
      );
      created++;
    }
  });
  audit(req, 'SCHEDULE_COPY_WEEK', 'schedule', null, { from: b.from, to: b.to, created }, b.store_id);
  res.json({ created, skipped: source.length - created });
});

export default router;
