// Skema database. Nominal uang disimpan sebagai INTEGER Rupiah; kuantitas REAL (mendukung barang timbang).
export const SCHEMA = /* sql */ `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_sequences (
  key TEXT PRIMARY KEY,
  last INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'MINIMARKET',
  address TEXT,
  city TEXT,
  phone TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS terminals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  UNIQUE (store_id, code)
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_no TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  pin_hash TEXT,
  role TEXT NOT NULL CHECK (role IN ('SUPER_ADMIN','HQ_ADMIN','STORE_MANAGER','SUPERVISOR','CASHIER','INVENTORY')),
  store_id INTEGER REFERENCES stores(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_login_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  payment_terms INTEGER NOT NULL DEFAULT 30,
  is_active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sku TEXT NOT NULL UNIQUE,
  barcode TEXT UNIQUE,
  plu_code TEXT UNIQUE,
  name TEXT NOT NULL,
  short_name TEXT,
  brand TEXT,
  category_id INTEGER REFERENCES categories(id),
  supplier_id INTEGER REFERENCES suppliers(id),
  unit TEXT NOT NULL DEFAULT 'PCS',
  cost_price INTEGER NOT NULL DEFAULT 0,
  sell_price INTEGER NOT NULL,
  tax_type TEXT NOT NULL DEFAULT 'PPN' CHECK (tax_type IN ('PPN','NON_PPN')),
  is_weighted INTEGER NOT NULL DEFAULT 0,
  min_stock REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_name ON products(name);

CREATE TABLE IF NOT EXISTS stock (
  store_id INTEGER NOT NULL REFERENCES stores(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  PRIMARY KEY (store_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  type TEXT NOT NULL,
  qty REAL NOT NULL,
  balance_after REAL NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  ref_no TEXT,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_movements_product ON stock_movements(store_id, product_id, id);
CREATE INDEX IF NOT EXISTS idx_movements_date ON stock_movements(created_at);

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_no TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL UNIQUE,
  email TEXT,
  birth_date TEXT,
  tier TEXT NOT NULL DEFAULT 'REGULAR',
  points INTEGER NOT NULL DEFAULT 0,
  total_spent INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  joined_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS member_point_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL REFERENCES members(id),
  type TEXT NOT NULL,
  points INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  ref_no TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_points_member ON member_point_ledger(member_id, id);

CREATE TABLE IF NOT EXISTS promotions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  type TEXT NOT NULL CHECK (type IN ('PERCENT','AMOUNT','SPECIAL_PRICE','BUY_X_GET_Y','BUNDLE_PRICE')),
  value REAL NOT NULL DEFAULT 0,
  buy_qty INTEGER,
  get_qty INTEGER,
  min_qty REAL NOT NULL DEFAULT 1,
  scope TEXT NOT NULL CHECK (scope IN ('PRODUCT','CATEGORY')),
  member_only INTEGER NOT NULL DEFAULT 0,
  store_id INTEGER REFERENCES stores(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS promotion_targets (
  promotion_id INTEGER NOT NULL REFERENCES promotions(id) ON DELETE CASCADE,
  target_id INTEGER NOT NULL,
  PRIMARY KEY (promotion_id, target_id)
);

CREATE TABLE IF NOT EXISTS shift_schedules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  terminal_id INTEGER NOT NULL REFERENCES terminals(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_schedules_terminal ON shift_schedules(terminal_id, start_at);
CREATE INDEX IF NOT EXISTS idx_schedules_user ON shift_schedules(user_id, start_at);
CREATE INDEX IF NOT EXISTS idx_schedules_store ON shift_schedules(store_id, start_at);

CREATE TABLE IF NOT EXISTS shifts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_no TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  terminal_id INTEGER NOT NULL REFERENCES terminals(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  schedule_id INTEGER REFERENCES shift_schedules(id),
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  opening_cash INTEGER NOT NULL DEFAULT 0,
  expected_cash INTEGER,
  counted_cash INTEGER,
  variance INTEGER,
  denominations TEXT,
  closing_note TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_shifts_terminal ON shifts(terminal_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS uq_shift_open_terminal ON shifts(terminal_id) WHERE status = 'OPEN';

CREATE TABLE IF NOT EXISTS cash_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  type TEXT NOT NULL CHECK (type IN ('CASH_IN','CASH_OUT','PICKUP')),
  amount INTEGER NOT NULL,
  reason TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  receipt_no TEXT NOT NULL UNIQUE,
  client_ref TEXT UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  terminal_id INTEGER NOT NULL REFERENCES terminals(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  cashier_id INTEGER NOT NULL REFERENCES users(id),
  member_id INTEGER REFERENCES members(id),
  subtotal INTEGER NOT NULL,
  discount_total INTEGER NOT NULL DEFAULT 0,
  total INTEGER NOT NULL,
  dpp INTEGER NOT NULL DEFAULT 0,
  tax_amount INTEGER NOT NULL DEFAULT 0,
  tax_rate REAL NOT NULL DEFAULT 11,
  paid_total INTEGER NOT NULL,
  change_amount INTEGER NOT NULL DEFAULT 0,
  item_count REAL NOT NULL DEFAULT 0,
  points_earned INTEGER NOT NULL DEFAULT 0,
  points_redeemed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('COMPLETED','VOIDED')),
  void_reason TEXT,
  voided_by INTEGER REFERENCES users(id),
  voided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_sales_store_date ON sales(store_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sales_date ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_member ON sales(member_id);

CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  qty REAL NOT NULL,
  unit_price INTEGER NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0,
  gross INTEGER NOT NULL,
  discount INTEGER NOT NULL DEFAULT 0,
  net INTEGER NOT NULL,
  tax_type TEXT NOT NULL,
  promo_id INTEGER REFERENCES promotions(id),
  promo_name TEXT,
  returned_qty REAL NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

CREATE TABLE IF NOT EXISTS sale_payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  method TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reference TEXT
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS sale_returns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_no TEXT NOT NULL UNIQUE,
  sale_id INTEGER NOT NULL REFERENCES sales(id),
  store_id INTEGER NOT NULL REFERENCES stores(id),
  shift_id INTEGER NOT NULL REFERENCES shifts(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  total_refund INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_returns_shift ON sale_returns(shift_id);

CREATE TABLE IF NOT EXISTS sale_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  return_id INTEGER NOT NULL REFERENCES sale_returns(id),
  sale_item_id INTEGER NOT NULL REFERENCES sale_items(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  refund_amount INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS held_carts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  terminal_id INTEGER NOT NULL REFERENCES terminals(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  label TEXT,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_no TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  status TEXT NOT NULL DEFAULT 'DRAFT',
  expected_date TEXT,
  total INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  cost_price INTEGER NOT NULL,
  received_qty REAL NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS goods_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gr_no TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
  po_id INTEGER REFERENCES purchase_orders(id),
  invoice_no TEXT,
  total_cost INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS goods_receipt_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gr_id INTEGER NOT NULL REFERENCES goods_receipts(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL,
  cost_price INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_no TEXT NOT NULL UNIQUE,
  from_store_id INTEGER NOT NULL REFERENCES stores(id),
  to_store_id INTEGER NOT NULL REFERENCES stores(id),
  status TEXT NOT NULL DEFAULT 'IN_TRANSIT' CHECK (status IN ('IN_TRANSIT','RECEIVED','CANCELLED')),
  note TEXT,
  created_by INTEGER REFERENCES users(id),
  received_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES stock_transfers(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adj_no TEXT NOT NULL UNIQUE,
  store_id INTEGER NOT NULL REFERENCES stores(id),
  type TEXT NOT NULL,
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adjustment_id INTEGER NOT NULL REFERENCES stock_adjustments(id),
  product_id INTEGER NOT NULL REFERENCES products(id),
  system_qty REAL NOT NULL,
  actual_qty REAL NOT NULL,
  diff_qty REAL NOT NULL,
  cost_price INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id),
  store_id INTEGER REFERENCES stores(id),
  action TEXT NOT NULL,
  entity TEXT,
  entity_id INTEGER,
  details TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_date ON audit_logs(created_at);
`;
