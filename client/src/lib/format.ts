const nf = new Intl.NumberFormat('id-ID');

export const rp = (n: number | null | undefined) => `Rp ${nf.format(Math.round(n ?? 0))}`;

/** Rupiah tanpa prefix, untuk kolom tabel & struk. */
export const money = (n: number | null | undefined) => nf.format(Math.round(n ?? 0));

export const num = (n: number | null | undefined, digits = 0) =>
  (n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: digits });

export const qty = (n: number, weighted?: boolean | number) =>
  weighted ? n.toLocaleString('id-ID', { minimumFractionDigits: 3, maximumFractionDigits: 3 }) : num(n, 3);

export const pct = (n: number | null | undefined, digits = 1) => `${(n ?? 0).toLocaleString('id-ID', { maximumFractionDigits: digits })}%`;

/** Rupiah ringkas: Rp 1,2 M / Rp 45,3 jt / Rp 820 rb */
export function compactRp(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 2 })} M`;
  if (abs >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 1 })} jt`;
  if (abs >= 1e3) return `Rp ${(n / 1e3).toLocaleString('id-ID', { maximumFractionDigits: 0 })} rb`;
  return `Rp ${nf.format(n)}`;
}

const toDate = (s: string | Date) => (s instanceof Date ? s : new Date(s.replace(' ', 'T')));

export const fmtDate = (s?: string | null) =>
  s ? toDate(s).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (s?: string | null) =>
  s
    ? toDate(s).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

/** "07:00–15:00", atau "Kam, 05/11 07:00–15:00" dengan hari. */
export const fmtRange = (start: string, end: string, withDay = false) =>
  `${withDay ? `${toDate(start).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: '2-digit' })} ` : ''}${start.slice(11, 16)}–${end.slice(11, 16)}`;

export const fmtTime = (s?: string | null) => (s ? toDate(s).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '—');

const pad = (n: number) => String(n).padStart(2, '0');
export const isoDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function daysAgo(n: number) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDate(d);
}

/** Parse angka input pengguna format Indonesia ("12.500" atau "1,25"). */
export function parseNumber(s: string): number {
  const cleaned = s.trim().replace(/\s/g, '');
  if (!cleaned) return NaN;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(cleaned)) return Number(cleaned.replace(/\./g, '').replace(',', '.'));
  return Number(cleaned.replace(',', '.'));
}

export function maskMember(no?: string | null) {
  return no ? `${no.slice(0, 4)}••••${no.slice(-4)}` : '';
}

export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]) {
  const csv = rows
    .map((r) => r.map((c) => (c === null || c === undefined ? '' : /[",;\n]/.test(String(c)) ? `"${String(c).replace(/"/g, '""')}"` : c)).join(','))
    .join('\n');
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}
