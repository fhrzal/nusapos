import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { HQ_ROLES, ROLES, type Role } from '../../../shared/types';
import { all, insert, one, run } from '../db';
import { audit } from '../lib/audit';
import { badRequest, dateRange, forbidden, notFound, pagination, parse, qInt, qStr } from '../lib/http';
import { getSettings, saveSettings } from '../lib/settings';
import { assertStoreAccess, isHq, requirePerm, scopedStoreId } from '../middleware/auth';

const router = Router();

// ---------------------------------------------------------------- Toko & terminal
const storeSchema = z.object({
  code: z.string().trim().min(2).max(10).toUpperCase(),
  name: z.string().trim().min(2),
  type: z.enum(['MINIMARKET', 'SUPERMARKET', 'HYPERMARKET', 'DC']),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  is_active: z.boolean().optional(),
});

router.get('/stores', (req, res) => {
  const where = isHq(req) ? (req.query.all ? '1=1' : 's.is_active = 1') : 's.id = ?';
  const params = isHq(req) ? [] : [req.user!.store_id];
  res.json(
    all(
      `SELECT s.*, (SELECT COUNT(*) FROM terminals t WHERE t.store_id = s.id AND t.is_active = 1) AS terminal_count,
              (SELECT COUNT(*) FROM users u WHERE u.store_id = s.id AND u.is_active = 1) AS user_count
       FROM stores s WHERE ${where} ORDER BY s.code`,
      ...params,
    ),
  );
});

router.post('/stores', requirePerm('stores.manage'), (req, res) => {
  const b = parse(storeSchema, req.body);
  const id = insert(
    'INSERT INTO stores(code, name, type, address, city, phone) VALUES (?, ?, ?, ?, ?, ?)',
    b.code,
    b.name,
    b.type,
    b.address ?? null,
    b.city ?? null,
    b.phone ?? null,
  );
  audit(req, 'STORE_CREATE', 'store', id, b, id);
  res.status(201).json(one('SELECT * FROM stores WHERE id = ?', id));
});

router.put('/stores/:id', requirePerm('stores.manage'), (req, res) => {
  const b = parse(storeSchema, req.body);
  run(
    'UPDATE stores SET code=?, name=?, type=?, address=?, city=?, phone=?, is_active=? WHERE id=?',
    b.code,
    b.name,
    b.type,
    b.address ?? null,
    b.city ?? null,
    b.phone ?? null,
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  audit(req, 'STORE_UPDATE', 'store', Number(req.params.id), b, Number(req.params.id));
  res.json(one('SELECT * FROM stores WHERE id = ?', req.params.id));
});

router.get('/stores/:id/terminals', (req, res) => {
  assertStoreAccess(req, Number(req.params.id));
  res.json(all('SELECT * FROM terminals WHERE store_id = ? ORDER BY code', req.params.id));
});

const terminalSchema = z.object({
  code: z.string().trim().min(2).max(10).toUpperCase(),
  name: z.string().trim().min(2),
  is_active: z.boolean().optional(),
});

router.post('/stores/:id/terminals', requirePerm('stores.manage'), (req, res) => {
  const b = parse(terminalSchema, req.body);
  const id = insert('INSERT INTO terminals(store_id, code, name) VALUES (?, ?, ?)', req.params.id, b.code, b.name);
  audit(req, 'TERMINAL_CREATE', 'terminal', id, b, Number(req.params.id));
  res.status(201).json(one('SELECT * FROM terminals WHERE id = ?', id));
});

router.put('/terminals/:id', requirePerm('stores.manage'), (req, res) => {
  const b = parse(terminalSchema, req.body);
  run(
    'UPDATE terminals SET code=?, name=?, is_active=? WHERE id=?',
    b.code,
    b.name,
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  audit(req, 'TERMINAL_UPDATE', 'terminal', Number(req.params.id), b);
  res.json(one('SELECT * FROM terminals WHERE id = ?', req.params.id));
});

// ---------------------------------------------------------------- Pengguna
const userSchema = z.object({
  employee_no: z.string().trim().min(3),
  username: z
    .string()
    .trim()
    .min(3)
    .regex(/^[a-zA-Z0-9._-]+$/, 'hanya huruf, angka, titik, strip'),
  full_name: z.string().trim().min(2),
  role: z.enum(ROLES as [Role, ...Role[]]),
  store_id: z.number().int().nullable(),
  password: z.string().min(8, 'Password minimal 8 karakter').optional().or(z.literal('')),
  pin: z
    .string()
    .regex(/^\d{6}$/, 'PIN harus 6 digit')
    .optional()
    .or(z.literal('')),
  is_active: z.boolean().optional(),
});

function checkUserScope(req: Parameters<typeof isHq>[0], b: z.infer<typeof userSchema>) {
  const isHqRole = HQ_ROLES.includes(b.role);
  if (isHqRole && b.store_id !== null) throw badRequest('Role kantor pusat tidak boleh terikat ke toko');
  if (!isHqRole && b.store_id === null) throw badRequest('Role toko wajib memilih toko');
  if (b.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') throw forbidden('Hanya Super Admin yang dapat mengelola Super Admin');
  if (!isHq(req)) {
    if (b.store_id !== req.user!.store_id) throw forbidden('Anda hanya dapat mengelola pengguna di toko Anda');
    if (!['CASHIER', 'SUPERVISOR', 'INVENTORY'].includes(b.role)) throw forbidden('Role tersebut hanya dapat dibuat oleh kantor pusat');
  }
}

router.get('/users', requirePerm('users.manage'), (req, res) => {
  const storeId = scopedStoreId(req, req.query.store_id);
  const q = qStr(req.query.q);
  const role = qStr(req.query.role);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (storeId !== null) conds.push('u.store_id = ?'), params.push(storeId);
  if (q) conds.push('(u.full_name LIKE ? OR u.username LIKE ? OR u.employee_no LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  if (role) conds.push('u.role = ?'), params.push(role);
  res.json(
    all(
      `SELECT u.id, u.employee_no, u.username, u.full_name, u.role, u.store_id, u.is_active, u.last_login_at, u.created_at,
              s.code AS store_code, s.name AS store_name, (u.pin_hash IS NOT NULL) AS has_pin
       FROM users u LEFT JOIN stores s ON s.id = u.store_id
       ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY u.store_id IS NOT NULL, s.code, u.role, u.full_name`,
      ...params,
    ),
  );
});

router.post('/users', requirePerm('users.manage'), (req, res) => {
  const b = parse(userSchema, req.body);
  checkUserScope(req, b);
  if (!b.password) throw badRequest('Password wajib diisi untuk pengguna baru');
  const id = insert(
    'INSERT INTO users(employee_no, username, full_name, role, store_id, password_hash, pin_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
    b.employee_no,
    b.username,
    b.full_name,
    b.role,
    b.store_id,
    bcrypt.hashSync(b.password, 10),
    b.pin ? bcrypt.hashSync(b.pin, 10) : null,
  );
  audit(req, 'USER_CREATE', 'user', id, { username: b.username, role: b.role, store_id: b.store_id }, b.store_id);
  res.status(201).json({ id });
});

router.put('/users/:id', requirePerm('users.manage'), (req, res) => {
  const b = parse(userSchema, req.body);
  const existing = one<{ role: Role; store_id: number | null }>('SELECT role, store_id FROM users WHERE id = ?', req.params.id);
  if (!existing) throw notFound('Pengguna tidak ditemukan');
  if (existing.role === 'SUPER_ADMIN' && req.user!.role !== 'SUPER_ADMIN') throw forbidden('Hanya Super Admin yang dapat mengubah Super Admin');
  if (!isHq(req) && existing.store_id !== req.user!.store_id) throw forbidden('Pengguna bukan dari toko Anda');
  checkUserScope(req, b);
  if (Number(req.params.id) === req.user!.id && b.is_active === false) throw badRequest('Anda tidak dapat menonaktifkan akun sendiri');
  run(
    'UPDATE users SET employee_no=?, username=?, full_name=?, role=?, store_id=?, is_active=? WHERE id=?',
    b.employee_no,
    b.username,
    b.full_name,
    b.role,
    b.store_id,
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  if (b.password) run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(b.password, 10), req.params.id);
  if (b.pin) run('UPDATE users SET pin_hash = ? WHERE id = ?', bcrypt.hashSync(b.pin, 10), req.params.id);
  audit(
    req,
    'USER_UPDATE',
    'user',
    Number(req.params.id),
    { username: b.username, role: b.role, is_active: b.is_active, password_reset: !!b.password, pin_reset: !!b.pin },
    b.store_id,
  );
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Kategori & supplier
const categorySchema = z.object({
  code: z.string().trim().min(2).max(10).toUpperCase(),
  name: z.string().trim().min(2),
  is_active: z.boolean().optional(),
});

router.get('/categories', (_req, res) => {
  res.json(
    all(
      `SELECT c.*, (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.is_active = 1) AS product_count
       FROM categories c ORDER BY c.name`,
    ),
  );
});

router.post('/categories', requirePerm('products.manage'), (req, res) => {
  const b = parse(categorySchema, req.body);
  const id = insert('INSERT INTO categories(code, name) VALUES (?, ?)', b.code, b.name);
  audit(req, 'CATEGORY_CREATE', 'category', id, b);
  res.status(201).json({ id });
});

router.put('/categories/:id', requirePerm('products.manage'), (req, res) => {
  const b = parse(categorySchema, req.body);
  run('UPDATE categories SET code=?, name=?, is_active=? WHERE id=?', b.code, b.name, b.is_active === false ? 0 : 1, req.params.id);
  audit(req, 'CATEGORY_UPDATE', 'category', Number(req.params.id), b);
  res.json({ ok: true });
});

const supplierSchema = z.object({
  code: z.string().trim().min(2).max(12).toUpperCase(),
  name: z.string().trim().min(2),
  contact_person: z.string().trim().optional().nullable(),
  phone: z.string().trim().optional().nullable(),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  address: z.string().trim().optional().nullable(),
  payment_terms: z.number().int().min(0).max(180),
  is_active: z.boolean().optional(),
});

router.get('/suppliers', requirePerm('products.view', 'purchasing.manage'), (_req, res) => {
  res.json(
    all(
      `SELECT s.*, (SELECT COUNT(*) FROM products p WHERE p.supplier_id = s.id AND p.is_active = 1) AS product_count
       FROM suppliers s ORDER BY s.name`,
    ),
  );
});

router.post('/suppliers', requirePerm('products.manage'), (req, res) => {
  const b = parse(supplierSchema, req.body);
  const id = insert(
    'INSERT INTO suppliers(code, name, contact_person, phone, email, address, payment_terms) VALUES (?, ?, ?, ?, ?, ?, ?)',
    b.code,
    b.name,
    b.contact_person ?? null,
    b.phone ?? null,
    b.email || null,
    b.address ?? null,
    b.payment_terms,
  );
  audit(req, 'SUPPLIER_CREATE', 'supplier', id, b);
  res.status(201).json({ id });
});

router.put('/suppliers/:id', requirePerm('products.manage'), (req, res) => {
  const b = parse(supplierSchema, req.body);
  run(
    'UPDATE suppliers SET code=?, name=?, contact_person=?, phone=?, email=?, address=?, payment_terms=?, is_active=? WHERE id=?',
    b.code,
    b.name,
    b.contact_person ?? null,
    b.phone ?? null,
    b.email || null,
    b.address ?? null,
    b.payment_terms,
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  audit(req, 'SUPPLIER_UPDATE', 'supplier', Number(req.params.id), b);
  res.json({ ok: true });
});

// ---------------------------------------------------------------- Pengaturan
router.get('/settings', (_req, res) => {
  res.json(getSettings());
});

router.put('/settings', requirePerm('settings.manage'), (req, res) => {
  const b = parse(
    z.object({
      company_name: z.string().trim().min(2),
      company_brand: z.string().trim().min(2),
      company_npwp: z.string().trim(),
      company_address: z.string().trim(),
      tax_rate: z.number().min(0).max(50),
      receipt_footer: z.string(),
      points_per_amount: z.number().int().min(0),
      point_value: z.number().int().min(1),
      allow_negative_stock: z.boolean(),
      max_drawer_cash: z.number().int().min(0),
      auto_print_receipt: z.boolean(),
      void_requires_approval: z.boolean(),
      opening_cash_default: z.number().int().min(0),
      enforce_schedule: z.boolean(),
    }),
    req.body,
  );
  saveSettings(b);
  audit(req, 'SETTINGS_UPDATE', 'settings', null, b);
  res.json(getSettings());
});

// ---------------------------------------------------------------- Audit trail
router.get('/audit', requirePerm('audit.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const { start, end } = dateRange(req, 7);
  const storeId = scopedStoreId(req, req.query.store_id);
  const action = qStr(req.query.action);
  const userId = qInt(req.query.user_id);
  const conds = ['a.created_at >= ?', 'a.created_at < ?'];
  const params: unknown[] = [start, end];
  if (storeId !== null) conds.push('a.store_id = ?'), params.push(storeId);
  if (action) conds.push('a.action LIKE ?'), params.push(`%${action}%`);
  if (userId) conds.push('a.user_id = ?'), params.push(userId);
  const where = conds.join(' AND ');
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM audit_logs a WHERE ${where}`, ...params)!.n;
  const data = all(
    `SELECT a.*, u.full_name AS user_name, u.username, s.code AS store_code
     FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id LEFT JOIN stores s ON s.id = a.store_id
     WHERE ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  res.json({ data, total, page, limit });
});

export default router;
