import type { Request } from 'express';
import { z, ZodError } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string) => new HttpError(400, msg);
export const notFound = (msg = 'Data tidak ditemukan') => new HttpError(404, msg);
export const forbidden = (msg = 'Anda tidak memiliki akses untuk tindakan ini') => new HttpError(403, msg);
export const conflict = (msg: string) => new HttpError(409, msg);

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) throw result.error;
  return result.data;
}

export function zodMessage(err: ZodError): string {
  const issue = err.issues[0];
  const path = issue.path.join('.');
  return path ? `${path}: ${issue.message}` : issue.message;
}

export function pagination(req: Request) {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 25));
  return { page, limit, offset: (page - 1) * limit };
}

export function qStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

export function qInt(v: unknown): number | undefined {
  const n = Number(v);
  return v !== undefined && v !== '' && Number.isInteger(n) ? n : undefined;
}

// ---- Tanggal (zona waktu lokal server) ----
export const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function localDateTime(d = new Date()): string {
  return `${localDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return localDate(d);
}

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'format tanggal harus YYYY-MM-DD');

/** Rentang tanggal dari query (?from=&to=), default 30 hari terakhir. Hasil: [from 00:00, to+1 00:00). */
export function dateRange(req: Request, defaultDays = 30) {
  const to = qStr(req.query.to) ?? localDate();
  const from = qStr(req.query.from) ?? addDays(to, -(defaultDays - 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw badRequest('Format tanggal tidak valid');
  return { from, to, start: `${from} 00:00:00`, end: `${addDays(to, 1)} 00:00:00` };
}
