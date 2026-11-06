import { all, run } from '../db';

export const DEFAULT_SETTINGS: Record<string, string> = {
  company_name: 'PT Nusantara Retail Sejahtera',
  company_brand: 'NusaMart',
  company_npwp: '01.234.567.8-091.000',
  company_address: 'Jl. Jend. Sudirman Kav. 52-53, Jakarta Selatan 12190',
  tax_rate: '11',
  receipt_footer: 'Terima kasih telah berbelanja.',
  points_per_amount: '10000',
  point_value: '100',
  allow_negative_stock: '1',
  max_drawer_cash: '5000000',
  auto_print_receipt: '0',
  void_requires_approval: '1',
  opening_cash_default: '500000',
  enforce_schedule: '1',
};

export interface AppSettings {
  company_name: string;
  company_brand: string;
  company_npwp: string;
  company_address: string;
  tax_rate: number;
  receipt_footer: string;
  /** Nilai belanja (Rp) untuk mendapatkan 1 poin. */
  points_per_amount: number;
  /** Nilai tukar 1 poin dalam Rupiah. */
  point_value: number;
  allow_negative_stock: boolean;
  /** Batas uang di laci kasir sebelum disarankan pickup. */
  max_drawer_cash: number;
  auto_print_receipt: boolean;
  void_requires_approval: boolean;
  /** Modal laci standar saat shift dibuka otomatis dari jadwal. */
  opening_cash_default: number;
  /** Kasir hanya dapat membuka shift sesuai jadwal dari kepala toko. */
  enforce_schedule: boolean;
}

const NUMERIC = ['tax_rate', 'points_per_amount', 'point_value', 'max_drawer_cash', 'opening_cash_default'];
const BOOLEAN = ['allow_negative_stock', 'auto_print_receipt', 'void_requires_approval', 'enforce_schedule'];

export function getSettings(): AppSettings {
  const raw: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of all<{ key: string; value: string }>('SELECT key, value FROM settings')) raw[r.key] = r.value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = NUMERIC.includes(k) ? Number(v) : BOOLEAN.includes(k) ? v === '1' : v;
  }
  return out as unknown as AppSettings;
}

export function saveSettings(values: Partial<Record<keyof AppSettings, unknown>>) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
    const str = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
    run('INSERT INTO settings(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, str);
  }
}
