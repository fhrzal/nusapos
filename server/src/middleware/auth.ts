import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { can, type Permission } from '../../../shared/permissions';
import type { Role } from '../../../shared/types';
import { config } from '../config';
import { one } from '../db';
import { audit } from '../lib/audit';
import { forbidden, HttpError, qInt } from '../lib/http';

export interface AuthUser {
  id: number;
  username: string;
  full_name: string;
  employee_no: string;
  role: Role;
  store_id: number | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.jwtExpiresIn } as jwt.SignOptions);
}

export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Sesi tidak valid, silakan login kembali'));
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as unknown as { sub: number };
    const user = one<AuthUser>(
      'SELECT id, username, full_name, employee_no, role, store_id FROM users WHERE id = ? AND is_active = 1',
      payload.sub,
    );
    if (!user) return next(new HttpError(401, 'Akun tidak aktif'));
    req.user = user;
    next();
  } catch {
    next(new HttpError(401, 'Sesi berakhir, silakan login kembali'));
  }
}

export function requirePerm(...perms: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (perms.some((p) => can(req.user?.role, p))) return next();
    next(forbidden());
  };
}

export const isHq = (req: Request) => req.user!.store_id === null;

/**
 * Toko yang berlaku untuk request. User toko selalu dikunci ke tokonya;
 * user kantor pusat bebas memilih (null = semua toko).
 */
export function scopedStoreId(req: Request, requested?: unknown): number | null {
  if (!isHq(req)) return req.user!.store_id;
  return qInt(requested) ?? null;
}

/** Seperti scopedStoreId, tetapi toko wajib dipilih. */
export function requireStoreId(req: Request, requested?: unknown): number {
  const storeId = scopedStoreId(req, requested);
  if (storeId === null) throw new HttpError(400, 'Pilih toko terlebih dahulu');
  return storeId;
}

export function assertStoreAccess(req: Request, storeId: number) {
  if (!isHq(req) && req.user!.store_id !== storeId) throw forbidden('Anda tidak memiliki akses ke toko ini');
}

export const approvalSchema = z.object({
  username: z.string().min(1, 'username supervisor wajib diisi'),
  pin: z.string().min(4, 'PIN minimal 4 digit'),
});

export type ApprovalInput = z.infer<typeof approvalSchema>;

/** Verifikasi otorisasi supervisor (username + PIN) untuk tindakan sensitif. */
export function verifyApproval(req: Request, input: ApprovalInput, storeId: number, action: string): AuthUser {
  const approver = one<AuthUser & { pin_hash: string | null }>(
    'SELECT id, username, full_name, employee_no, role, store_id, pin_hash FROM users WHERE username = ? AND is_active = 1',
    input.username,
  );
  const valid = !!approver?.pin_hash && bcrypt.compareSync(input.pin, approver.pin_hash);
  if (!approver || !valid) {
    audit(req, 'APPROVAL_FAILED', null, null, { action, approver: input.username }, storeId);
    throw new HttpError(403, 'Username atau PIN supervisor salah');
  }
  if (!can(approver.role, 'pos.approve') || (approver.store_id !== null && approver.store_id !== storeId)) {
    throw new HttpError(403, `${approver.full_name} tidak berwenang memberi otorisasi di toko ini`);
  }
  const { pin_hash: _, ...user } = approver;
  return user;
}

// Pembatas percobaan login sederhana (per IP + username).
const attempts = new Map<string, { count: number; until: number }>();
const MAX_ATTEMPTS = 5;
const LOCK_MS = 5 * 60 * 1000;

export function checkLoginThrottle(key: string) {
  const entry = attempts.get(key);
  if (entry && entry.count >= MAX_ATTEMPTS && entry.until > Date.now()) {
    const minutes = Math.ceil((entry.until - Date.now()) / 60000);
    throw new HttpError(429, `Terlalu banyak percobaan login. Coba lagi dalam ${minutes} menit.`);
  }
}

export function recordLoginFailure(key: string) {
  const entry = attempts.get(key);
  const count = entry && entry.until > Date.now() ? entry.count + 1 : 1;
  attempts.set(key, { count, until: Date.now() + LOCK_MS });
}

export const clearLoginFailures = (key: string) => attempts.delete(key);
