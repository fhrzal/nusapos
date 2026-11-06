import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { MEMBER_TIERS, type MemberTier } from '../../../shared/types';
import { all, insert, one, run } from '../db';
import { audit } from '../lib/audit';
import { badRequest, notFound, pagination, parse, qStr } from '../lib/http';
import { requirePerm } from '../middleware/auth';

const router = Router();

const normalizePhone = (phone: string) => phone.replace(/[^\d]/g, '').replace(/^62/, '0');

function generateMemberNo(): string {
  for (;;) {
    const no = `8899${crypto.randomInt(0, 1e12).toString().padStart(12, '0')}`;
    if (!one('SELECT 1 FROM members WHERE member_no = ?', no)) return no;
  }
}

router.get('/', requirePerm('members.view'), (req, res) => {
  const { page, limit, offset } = pagination(req);
  const q = qStr(req.query.q);
  const tier = qStr(req.query.tier);
  const conds: string[] = [];
  const params: unknown[] = [];
  if (q) conds.push('(name LIKE ? OR phone LIKE ? OR member_no LIKE ?)'), params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  if (tier) conds.push('tier = ?'), params.push(tier);
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = one<{ n: number }>(`SELECT COUNT(*) n FROM members ${where}`, ...params)!.n;
  const data = all(`SELECT * FROM members ${where} ORDER BY name LIMIT ? OFFSET ?`, ...params, limit, offset);
  const stats = one(
    `SELECT COUNT(*) AS total, COALESCE(SUM(points), 0) AS points, COALESCE(SUM(total_spent), 0) AS spent,
       SUM(joined_at >= datetime('now','localtime','-30 days')) AS new_30d FROM members WHERE is_active = 1`,
  );
  res.json({ data, total, page, limit, stats });
});

/** Pencarian tepat oleh kasir: nomor kartu atau nomor HP. */
router.get('/lookup', requirePerm('members.view'), (req, res) => {
  const q = qStr(req.query.q);
  if (!q) throw badRequest('Nomor member / HP wajib diisi');
  const member = one('SELECT * FROM members WHERE is_active = 1 AND (member_no = ? OR phone = ?)', q, normalizePhone(q));
  if (!member) throw notFound('Member tidak ditemukan');
  res.json(member);
});

router.get('/:id', requirePerm('members.view'), (req, res) => {
  const member = one('SELECT * FROM members WHERE id = ?', req.params.id);
  if (!member) throw notFound('Member tidak ditemukan');
  const ledger = all('SELECT * FROM member_point_ledger WHERE member_id = ? ORDER BY id DESC LIMIT 50', req.params.id);
  const sales = all(
    `SELECT s.id, s.receipt_no, s.total, s.points_earned, s.points_redeemed, s.status, s.created_at, st.code AS store_code
     FROM sales s JOIN stores st ON st.id = s.store_id WHERE s.member_id = ? ORDER BY s.id DESC LIMIT 20`,
    req.params.id,
  );
  res.json({ ...member, ledger, sales });
});

const memberSchema = z.object({
  name: z.string().trim().min(2),
  phone: z
    .string()
    .trim()
    .transform(normalizePhone)
    .refine((v) => /^08\d{8,12}$/.test(v), 'nomor HP tidak valid (contoh: 081234567890)'),
  email: z.string().trim().email().optional().nullable().or(z.literal('')),
  birth_date: z.string().optional().nullable().or(z.literal('')),
  tier: z.enum(MEMBER_TIERS as [MemberTier, ...MemberTier[]]).optional(),
  is_active: z.boolean().optional(),
});

router.post('/', requirePerm('members.manage'), (req, res) => {
  const b = parse(memberSchema, req.body);
  const memberNo = generateMemberNo();
  const id = insert(
    'INSERT INTO members(member_no, name, phone, email, birth_date, tier) VALUES (?, ?, ?, ?, ?, ?)',
    memberNo,
    b.name,
    b.phone,
    b.email || null,
    b.birth_date || null,
    b.tier ?? 'REGULAR',
  );
  audit(req, 'MEMBER_CREATE', 'member', id, { member_no: memberNo, name: b.name });
  res.status(201).json(one('SELECT * FROM members WHERE id = ?', id));
});

router.put('/:id', requirePerm('members.manage'), (req, res) => {
  const b = parse(memberSchema, req.body);
  const r = run(
    'UPDATE members SET name=?, phone=?, email=?, birth_date=?, tier=COALESCE(?, tier), is_active=? WHERE id=?',
    b.name,
    b.phone,
    b.email || null,
    b.birth_date || null,
    b.tier ?? null,
    b.is_active === false ? 0 : 1,
    req.params.id,
  );
  if (!r.changes) throw notFound('Member tidak ditemukan');
  audit(req, 'MEMBER_UPDATE', 'member', Number(req.params.id), b);
  res.json(one('SELECT * FROM members WHERE id = ?', req.params.id));
});

export default router;
