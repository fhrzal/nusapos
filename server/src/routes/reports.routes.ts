import { Router } from 'express';
import { all, one } from '../db';
import { addDays, badRequest, dateRange, localDate, localDateTime, qStr } from '../lib/http';
import { requirePerm, scopedStoreId } from '../middleware/auth';

const router = Router();

// Nilai bersih (setelah retur) tanpa PPN, dan HPP setelah retur — untuk laba kotor.
const NET_EXCL_TAX = `(CASE WHEN si.tax_type = 'PPN' THEN si.net * 100.0 / (100 + s.tax_rate) ELSE si.net END) * (si.qty - si.returned_qty) / si.qty`;
const COGS = `si.cost_price * (si.qty - si.returned_qty)`;

function storeFilter(storeId: number | null, alias = 's') {
  return storeId === null ? { sql: '', params: [] as unknown[] } : { sql: ` AND ${alias}.store_id = ?`, params: [storeId] };
}

function kpi(start: string, end: string, storeId: number | null) {
  const f = storeFilter(storeId);
  const sales = one<Record<string, number>>(
    `SELECT COUNT(*) AS trx, COALESCE(SUM(total), 0) AS sales, COALESCE(SUM(item_count), 0) AS items,
       COALESCE(SUM(discount_total), 0) AS discount, COALESCE(SUM(member_id IS NOT NULL), 0) AS member_trx
     FROM sales s WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?${f.sql}`,
    start,
    end,
    ...f.params,
  )!;
  const margin = one<{ revenue: number; cogs: number }>(
    `SELECT COALESCE(SUM(${NET_EXCL_TAX}), 0) AS revenue, COALESCE(SUM(${COGS}), 0) AS cogs
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?${f.sql}`,
    start,
    end,
    ...f.params,
  )!;
  const returns = one<{ amount: number }>(
    `SELECT COALESCE(SUM(total_refund), 0) AS amount FROM sale_returns s WHERE s.created_at >= ? AND s.created_at < ?${f.sql}`,
    start,
    end,
    ...f.params,
  )!;
  return {
    ...sales,
    returns: returns.amount,
    net_sales: sales.sales - returns.amount,
    avg_basket: sales.trx ? Math.round(sales.sales / sales.trx) : 0,
    gross_profit: Math.round(margin.revenue - margin.cogs),
    margin_pct: margin.revenue ? ((margin.revenue - margin.cogs) / margin.revenue) * 100 : 0,
  };
}

router.get('/dashboard', requirePerm('dashboard.view'), (req, res) => {
  const storeId = scopedStoreId(req, req.query.store_id);
  const f = storeFilter(storeId);
  const now = new Date();
  const today = localDate(now);
  const yesterday = addDays(today, -1);
  const timeNow = localDateTime(now).slice(11);

  // Pembanding "hari ini" adalah kemarin pada jam yang sama (like-for-like).
  const todayKpi = kpi(`${today} 00:00:00`, `${addDays(today, 1)} 00:00:00`, storeId);
  const yesterdayKpi = kpi(`${yesterday} 00:00:00`, `${yesterday} ${timeNow}`, storeId);
  const monthStart = `${today.slice(0, 8)}01`;
  const monthKpi = kpi(`${monthStart} 00:00:00`, `${addDays(today, 1)} 00:00:00`, storeId);

  const trendStart = addDays(today, -29);
  const trend = all(
    `SELECT date(s.created_at) AS date, COALESCE(SUM(s.total), 0) AS sales, COUNT(*) AS trx
     FROM sales s WHERE s.status = 'COMPLETED' AND s.created_at >= ?${f.sql} GROUP BY 1 ORDER BY 1`,
    `${trendStart} 00:00:00`,
    ...f.params,
  );
  const hourly = all(
    `SELECT CAST(strftime('%H', s.created_at) AS INTEGER) AS hour,
       COALESCE(SUM(CASE WHEN date(s.created_at) = ? THEN s.total END), 0) AS today,
       COALESCE(SUM(CASE WHEN date(s.created_at) = ? THEN s.total END), 0) AS yesterday
     FROM sales s WHERE s.status = 'COMPLETED' AND s.created_at >= ?${f.sql} GROUP BY 1 ORDER BY 1`,
    today,
    yesterday,
    `${yesterday} 00:00:00`,
    ...f.params,
  );
  const weekStart = `${addDays(today, -6)} 00:00:00`;
  const topProducts = all(
    `SELECT si.product_id, si.name, si.sku, SUM(si.qty - si.returned_qty) AS qty, SUM(si.net) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ?${f.sql} GROUP BY si.product_id ORDER BY revenue DESC LIMIT 10`,
    weekStart,
    ...f.params,
  );
  const categories = all(
    `SELECT COALESCE(c.name, 'Tanpa Kategori') AS name, SUM(si.net) AS revenue
     FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
     LEFT JOIN categories c ON c.id = p.category_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ?${f.sql} GROUP BY c.id ORDER BY revenue DESC`,
    `${trendStart} 00:00:00`,
    ...f.params,
  );
  const payments = all(
    `SELECT sp.method, COUNT(*) AS count,
       SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount - s.change_amount ELSE sp.amount END) AS amount
     FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
     WHERE s.status = 'COMPLETED' AND s.created_at >= ?${f.sql} GROUP BY sp.method ORDER BY amount DESC`,
    `${trendStart} 00:00:00`,
    ...f.params,
  );
  const stores =
    storeId === null
      ? all(
          `SELECT st.id, st.code, st.name, st.type,
             COALESCE(SUM(CASE WHEN date(s.created_at) = ? THEN s.total END), 0) AS today_sales,
             COUNT(CASE WHEN date(s.created_at) = ? THEN 1 END) AS today_trx,
             COALESCE(SUM(s.total), 0) AS month_sales
           FROM stores st LEFT JOIN sales s ON s.store_id = st.id AND s.status = 'COMPLETED' AND s.created_at >= ?
           WHERE st.is_active = 1 GROUP BY st.id ORDER BY month_sales DESC`,
          today,
          today,
          `${monthStart} 00:00:00`,
        )
      : [];
  const lowStock = all(
    `SELECT p.id, p.sku, p.name, p.unit, p.min_stock, st.qty AS stock, s.code AS store_code
     FROM stock st JOIN products p ON p.id = st.product_id JOIN stores s ON s.id = st.store_id
     WHERE p.is_active = 1 AND st.qty <= p.min_stock AND s.is_active = 1${f.sql.replace('s.store_id', 'st.store_id')}
     ORDER BY (st.qty - p.min_stock) ASC LIMIT 8`,
    ...f.params,
  );
  const lowStockCount = one<{ n: number }>(
    `SELECT COUNT(*) n FROM stock st JOIN products p ON p.id = st.product_id
     WHERE p.is_active = 1 AND st.qty <= p.min_stock${f.sql.replace('s.store_id', 'st.store_id')}`,
    ...f.params,
  )!.n;
  const openShifts = all(
    `SELECT sh.id, sh.shift_no, sh.opened_at, u.full_name AS cashier_name, t.code AS terminal_code, st.code AS store_code,
       (SELECT COALESCE(SUM(total), 0) FROM sales x WHERE x.shift_id = sh.id AND x.status = 'COMPLETED') AS sales_total
     FROM shifts sh JOIN users u ON u.id = sh.user_id JOIN terminals t ON t.id = sh.terminal_id JOIN stores st ON st.id = sh.store_id
     WHERE sh.status = 'OPEN'${f.sql.replace('s.store_id', 'sh.store_id')} ORDER BY sh.opened_at`,
    ...f.params,
  );
  const recent = all(
    `SELECT s.id, s.receipt_no, s.total, s.status, s.created_at, st.code AS store_code, u.full_name AS cashier_name
     FROM sales s JOIN stores st ON st.id = s.store_id JOIN users u ON u.id = s.cashier_id
     WHERE 1 = 1${f.sql} ORDER BY s.id DESC LIMIT 8`,
    ...f.params,
  );

  res.json({
    today: todayKpi,
    yesterday: yesterdayKpi,
    month: monthKpi,
    trend,
    hourly,
    topProducts,
    categories,
    payments,
    stores,
    lowStock,
    lowStockCount,
    openShifts,
    recent,
  });
});

const SALES_GROUPS: Record<string, { key: string; label: string; join?: string }> = {
  day: { key: 'date(s.created_at)', label: 'date(s.created_at)' },
  hour: { key: "strftime('%H', s.created_at)", label: "strftime('%H', s.created_at) || ':00'" },
  store: { key: 's.store_id', label: "st.code || ' — ' || st.name", join: 'JOIN stores st ON st.id = s.store_id' },
  cashier: { key: 's.cashier_id', label: "u.full_name || ' (' || u.employee_no || ')'", join: 'JOIN users u ON u.id = s.cashier_id' },
  terminal: {
    key: 's.terminal_id',
    label: "st.code || ' / ' || t.code",
    join: 'JOIN terminals t ON t.id = s.terminal_id JOIN stores st ON st.id = s.store_id',
  },
};

const ITEM_GROUPS: Record<string, { key: string; label: string; extra?: string; join?: string }> = {
  product: { key: 'si.product_id', label: 'si.name', extra: ', si.sku AS code' },
  category: {
    key: 'p.category_id',
    label: "COALESCE(c.name, 'Tanpa Kategori')",
    join: 'JOIN products p ON p.id = si.product_id LEFT JOIN categories c ON c.id = p.category_id',
  },
  supplier: {
    key: 'p.supplier_id',
    label: "COALESCE(sp.name, 'Tanpa Supplier')",
    join: 'JOIN products p ON p.id = si.product_id LEFT JOIN suppliers sp ON sp.id = p.supplier_id',
  },
  promo: { key: 'si.promo_id', label: 'si.promo_name' },
};

router.get('/sales', requirePerm('reports.view'), (req, res) => {
  const { from, to, start, end } = dateRange(req, 30);
  const storeId = scopedStoreId(req, req.query.store_id);
  const groupBy = qStr(req.query.group_by) ?? 'day';
  const f = storeFilter(storeId);
  const base = `s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at < ?${f.sql}`;
  const params = [start, end, ...f.params];
  let rows: Record<string, any>[];

  if (SALES_GROUPS[groupBy]) {
    const g = SALES_GROUPS[groupBy];
    rows = all(
      `SELECT ${g.label} AS label, COUNT(*) AS trx, SUM(s.item_count) AS items, SUM(s.subtotal) AS gross,
         SUM(s.discount_total) AS discount, SUM(s.total) AS net, SUM(s.dpp) AS dpp, SUM(s.tax_amount) AS tax,
         ROUND(AVG(s.total)) AS avg_basket, SUM(s.member_id IS NOT NULL) AS member_trx
       FROM sales s ${g.join ?? ''} WHERE ${base} GROUP BY ${g.key} ORDER BY ${groupBy === 'day' || groupBy === 'hour' ? 'label' : 'net DESC'}`,
      ...params,
    );
  } else if (ITEM_GROUPS[groupBy]) {
    const g = ITEM_GROUPS[groupBy];
    rows = all(
      `SELECT ${g.label} AS label ${g.extra ?? ''}, SUM(si.qty - si.returned_qty) AS qty, SUM(si.gross) AS gross,
         SUM(si.discount) AS discount, SUM(si.net) AS net, COUNT(DISTINCT si.sale_id) AS trx,
         ROUND(SUM(${NET_EXCL_TAX})) AS revenue_excl_tax, SUM(${COGS}) AS cogs,
         ROUND(SUM(${NET_EXCL_TAX}) - SUM(${COGS})) AS gross_profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id ${g.join ?? ''}
       WHERE ${base}${groupBy === 'promo' ? ' AND si.promo_id IS NOT NULL' : ''}
       GROUP BY ${g.key} ORDER BY net DESC LIMIT 1000`,
      ...params,
    );
  } else if (groupBy === 'payment') {
    rows = all(
      `SELECT sp.method AS label, COUNT(*) AS trx,
         SUM(CASE WHEN sp.method = 'CASH' THEN sp.amount - s.change_amount ELSE sp.amount END) AS net
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id WHERE ${base} GROUP BY sp.method ORDER BY net DESC`,
      ...params,
    );
  } else {
    throw badRequest('Pengelompokan laporan tidak dikenal');
  }

  const summary = kpi(start, end, storeId);
  res.json({ from, to, group_by: groupBy, rows, summary });
});

export default router;
