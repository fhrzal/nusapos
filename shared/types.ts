// Tipe & konstanta domain yang dipakai bersama oleh server dan client.

export type Role = 'SUPER_ADMIN' | 'HQ_ADMIN' | 'STORE_MANAGER' | 'SUPERVISOR' | 'CASHIER' | 'INVENTORY';

export const ROLES: Role[] = ['SUPER_ADMIN', 'HQ_ADMIN', 'STORE_MANAGER', 'SUPERVISOR', 'CASHIER', 'INVENTORY'];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  HQ_ADMIN: 'Admin Kantor Pusat',
  STORE_MANAGER: 'Kepala Toko',
  SUPERVISOR: 'Supervisor',
  CASHIER: 'Kasir',
  INVENTORY: 'Staf Gudang',
};

/** Role kantor pusat tidak terikat ke satu toko. */
export const HQ_ROLES: Role[] = ['SUPER_ADMIN', 'HQ_ADMIN'];

export type StoreType = 'MINIMARKET' | 'SUPERMARKET' | 'HYPERMARKET' | 'DC';

export const STORE_TYPE_LABELS: Record<StoreType, string> = {
  MINIMARKET: 'Minimarket',
  SUPERMARKET: 'Supermarket',
  HYPERMARKET: 'Hypermarket',
  DC: 'Distribution Center',
};

export type TaxType = 'PPN' | 'NON_PPN';

export type PromoType = 'PERCENT' | 'AMOUNT' | 'SPECIAL_PRICE' | 'BUY_X_GET_Y' | 'BUNDLE_PRICE';

export const PROMO_TYPE_LABELS: Record<PromoType, string> = {
  PERCENT: 'Diskon Persen',
  AMOUNT: 'Potongan Harga / Unit',
  SPECIAL_PRICE: 'Harga Spesial',
  BUY_X_GET_Y: 'Beli X Gratis Y',
  BUNDLE_PRICE: 'Harga Paket (X pcs)',
};

export type PaymentMethod = 'CASH' | 'DEBIT' | 'CREDIT' | 'QRIS' | 'EWALLET' | 'VOUCHER' | 'POINTS';

export const PAYMENT_METHODS: { code: PaymentMethod; label: string; requiresReference: boolean }[] = [
  { code: 'CASH', label: 'Tunai', requiresReference: false },
  { code: 'DEBIT', label: 'Kartu Debit', requiresReference: true },
  { code: 'CREDIT', label: 'Kartu Kredit', requiresReference: true },
  { code: 'QRIS', label: 'QRIS', requiresReference: true },
  { code: 'EWALLET', label: 'E-Wallet', requiresReference: true },
  { code: 'VOUCHER', label: 'Voucher', requiresReference: true },
  { code: 'POINTS', label: 'Poin Member', requiresReference: false },
];

export const PAYMENT_LABELS = Object.fromEntries(PAYMENT_METHODS.map((m) => [m.code, m.label])) as Record<
  PaymentMethod,
  string
>;

export type StockMovementType =
  | 'OPENING'
  | 'SALE'
  | 'VOID'
  | 'RETURN'
  | 'RECEIVE'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN'
  | 'ADJUSTMENT'
  | 'OPNAME'
  | 'DAMAGE'
  | 'EXPIRED'
  | 'LOST';

export const MOVEMENT_LABELS: Record<StockMovementType, string> = {
  OPENING: 'Saldo Awal',
  SALE: 'Penjualan',
  VOID: 'Void Penjualan',
  RETURN: 'Retur Penjualan',
  RECEIVE: 'Penerimaan Barang',
  TRANSFER_OUT: 'Transfer Keluar',
  TRANSFER_IN: 'Transfer Masuk',
  ADJUSTMENT: 'Penyesuaian',
  OPNAME: 'Stock Opname',
  DAMAGE: 'Barang Rusak',
  EXPIRED: 'Kedaluwarsa',
  LOST: 'Barang Hilang',
};

export type AdjustmentType = 'OPNAME' | 'ADJUSTMENT' | 'DAMAGE' | 'EXPIRED' | 'LOST';

export const ADJUSTMENT_TYPES: AdjustmentType[] = ['OPNAME', 'ADJUSTMENT', 'DAMAGE', 'EXPIRED', 'LOST'];

export type CashMovementType = 'CASH_IN' | 'CASH_OUT' | 'PICKUP';

export const CASH_MOVEMENT_LABELS: Record<CashMovementType, string> = {
  CASH_IN: 'Kas Masuk',
  CASH_OUT: 'Kas Keluar',
  PICKUP: 'Setoran / Pickup',
};

export type MemberTier = 'REGULAR' | 'SILVER' | 'GOLD' | 'PLATINUM';

export const MEMBER_TIERS: MemberTier[] = ['REGULAR', 'SILVER', 'GOLD', 'PLATINUM'];

export type PurchaseOrderStatus = 'DRAFT' | 'APPROVED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';

export const PO_STATUS_LABELS: Record<PurchaseOrderStatus, string> = {
  DRAFT: 'Draft',
  APPROVED: 'Disetujui',
  PARTIAL: 'Diterima Sebagian',
  RECEIVED: 'Diterima',
  CANCELLED: 'Dibatalkan',
};

/** Pecahan uang Rupiah untuk hitung kas saat tutup shift. */
export const CASH_DENOMINATIONS = [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100];
