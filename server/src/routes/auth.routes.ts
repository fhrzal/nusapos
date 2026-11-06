import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { permissionsFor } from '../../../shared/permissions';
import { one, run } from '../db';
import { audit } from '../lib/audit';
import { badRequest, HttpError, parse } from '../lib/http';
import {
  approvalSchema,
  authenticate,
  type AuthUser,
  checkLoginThrottle,
  clearLoginFailures,
  recordLoginFailure,
  signToken,
  verifyApproval,
} from '../middleware/auth';

const router = Router();

function profile(user: AuthUser) {
  const store = user.store_id
    ? one('SELECT id, code, name, type, address, city, phone FROM stores WHERE id = ?', user.store_id)
    : null;
  return { ...user, store, permissions: permissionsFor(user.role) };
}

router.post('/login', (req, res) => {
  const { username, password } = parse(
    z.object({ username: z.string().trim().min(1), password: z.string().min(1) }),
    req.body,
  );
  const key = `${req.ip}:${username.toLowerCase()}`;
  checkLoginThrottle(key);
  const row = one<AuthUser & { password_hash: string; is_active: number }>(
    'SELECT id, username, full_name, employee_no, role, store_id, password_hash, is_active FROM users WHERE username = ?',
    username,
  );
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    recordLoginFailure(key);
    audit(req, 'LOGIN_FAILED', 'user', row?.id ?? null, { username });
    throw new HttpError(401, 'Username atau password salah');
  }
  if (!row.is_active) throw new HttpError(403, 'Akun Anda dinonaktifkan. Hubungi administrator.');
  clearLoginFailures(key);
  const { password_hash: _, is_active: __, ...user } = row;
  run(`UPDATE users SET last_login_at = datetime('now','localtime') WHERE id = ?`, user.id);
  req.user = user;
  audit(req, 'LOGIN', 'user', user.id);
  res.json({ token: signToken(user), user: profile(user) });
});

router.get('/me', authenticate, (req, res) => {
  res.json(profile(req.user!));
});

router.post('/verify-supervisor', authenticate, (req, res) => {
  const body = parse(
    approvalSchema.extend({ store_id: z.number().int(), action: z.string().min(1), note: z.string().optional() }),
    req.body,
  );
  const approver = verifyApproval(req, body, body.store_id, body.action);
  audit(req, 'APPROVAL', null, null, { action: body.action, note: body.note, approver: approver.username }, body.store_id);
  res.json({ approver: { id: approver.id, full_name: approver.full_name, username: approver.username } });
});

/** Buka kunci layar kasir dengan password sendiri (sesi tetap berjalan). */
router.post('/verify-password', authenticate, (req, res) => {
  const { password } = parse(z.object({ password: z.string().min(1) }), req.body);
  const key = `unlock:${req.user!.id}`;
  checkLoginThrottle(key);
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
  if (!bcrypt.compareSync(password, row.password_hash)) {
    recordLoginFailure(key);
    audit(req, 'UNLOCK_FAILED', 'user', req.user!.id);
    throw badRequest('Password salah');
  }
  clearLoginFailures(key);
  res.json({ ok: true });
});

router.post('/change-password', authenticate, (req, res) => {
  const body = parse(
    z.object({ current_password: z.string().min(1), new_password: z.string().min(8, 'Password minimal 8 karakter') }),
    req.body,
  );
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
  if (!bcrypt.compareSync(body.current_password, row.password_hash)) throw badRequest('Password saat ini salah');
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(body.new_password, 10), req.user!.id);
  audit(req, 'CHANGE_PASSWORD', 'user', req.user!.id);
  res.json({ ok: true });
});

router.post('/change-pin', authenticate, (req, res) => {
  const body = parse(
    z.object({ current_password: z.string().min(1), new_pin: z.string().regex(/^\d{6}$/, 'PIN harus 6 digit angka') }),
    req.body,
  );
  const row = one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', req.user!.id)!;
  if (!bcrypt.compareSync(body.current_password, row.password_hash)) throw badRequest('Password salah');
  run('UPDATE users SET pin_hash = ? WHERE id = ?', bcrypt.hashSync(body.new_pin, 10), req.user!.id);
  audit(req, 'CHANGE_PIN', 'user', req.user!.id);
  res.json({ ok: true });
});

export default router;
