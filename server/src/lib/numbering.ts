import { one } from '../db';
import { pad } from './http';

export function nextSeq(key: string): number {
  return one<{ last: number }>(
    `INSERT INTO doc_sequences(key, last) VALUES (?, 1)
     ON CONFLICT(key) DO UPDATE SET last = last + 1 RETURNING last`,
    key,
  )!.last;
}

const yymm = (d: Date) => `${String(d.getFullYear()).slice(2)}${pad(d.getMonth() + 1)}`;
const yymmdd = (d: Date) => `${yymm(d)}${pad(d.getDate())}`;

/** Nomor dokumen: GR/JKT01/2611/0001 — urutan direset per bulan per toko. */
export function docNo(prefix: string, storeCode: string, date = new Date()): string {
  const period = yymm(date);
  const seq = nextSeq(`${prefix}:${storeCode}:${period}`);
  return `${prefix}/${storeCode}/${period}/${pad(seq, 4)}`;
}

/** Nomor struk: JKT01-01-261102-0001 — urutan direset per hari per terminal. */
export function receiptNo(storeCode: string, terminalCode: string, date = new Date()): string {
  const day = yymmdd(date);
  const term = terminalCode.replace(/\D/g, '').padStart(2, '0');
  const seq = nextSeq(`RCP:${storeCode}:${term}:${day}`);
  return `${storeCode}-${term}-${day}-${pad(seq, 4)}`;
}
