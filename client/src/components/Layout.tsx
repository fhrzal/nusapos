import type { Permission } from '@shared/permissions';
import { ROLE_LABELS } from '@shared/types';
import {
  ArrowLeftRight,
  BadgePercent,
  BarChart3,
  Boxes,
  CalendarClock,
  ClipboardCheck,
  ClipboardList,
  Clock,
  FileClock,
  History,
  LayoutDashboard,
  LogOut,
  Menu,
  MonitorSmartphone,
  Package,
  PackagePlus,
  Receipt,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  Truck,
  UserCog,
  Users,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useClock } from '../lib/hooks';
import { cx } from './ui';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  perm: Permission;
}

export const NAV: { title: string; items: NavItem[] }[] = [
  { title: 'Ringkasan', items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'dashboard.view' }] },
  {
    title: 'Penjualan',
    items: [
      { to: '/sales', label: 'Transaksi', icon: Receipt, perm: 'sales.view' },
      { to: '/shifts', label: 'Shift Kasir', icon: Clock, perm: 'shifts.view' },
      { to: '/schedules', label: 'Jadwal Kasir', icon: CalendarClock, perm: 'schedules.manage' },
      { to: '/reports', label: 'Laporan Penjualan', icon: BarChart3, perm: 'reports.view' },
    ],
  },
  {
    title: 'Produk & Harga',
    items: [
      { to: '/products', label: 'Produk', icon: Package, perm: 'products.view' },
      { to: '/master', label: 'Kategori & Supplier', icon: Truck, perm: 'products.view' },
      { to: '/promotions', label: 'Promosi', icon: BadgePercent, perm: 'promotions.manage' },
      { to: '/labels', label: 'Label Harga Rak', icon: Tags, perm: 'products.view' },
    ],
  },
  {
    title: 'Persediaan',
    items: [
      { to: '/inventory/stock', label: 'Stok Barang', icon: Boxes, perm: 'inventory.view' },
      { to: '/purchasing', label: 'Purchase Order', icon: ClipboardList, perm: 'inventory.view' },
      { to: '/inventory/receipts', label: 'Penerimaan Barang', icon: PackagePlus, perm: 'inventory.view' },
      { to: '/inventory/transfers', label: 'Transfer Stok', icon: ArrowLeftRight, perm: 'inventory.view' },
      { to: '/inventory/adjustments', label: 'Opname & Penyesuaian', icon: ClipboardCheck, perm: 'inventory.view' },
      { to: '/inventory/movements', label: 'Kartu Stok', icon: History, perm: 'inventory.view' },
    ],
  },
  { title: 'Pelanggan', items: [{ to: '/members', label: 'Member & Poin', icon: Users, perm: 'members.view' }] },
  {
    title: 'Administrasi',
    items: [
      { to: '/users', label: 'Pengguna', icon: UserCog, perm: 'users.manage' },
      { to: '/stores', label: 'Toko & Terminal', icon: Store, perm: 'stores.manage' },
      { to: '/audit', label: 'Audit Trail', icon: FileClock, perm: 'audit.view' },
    ],
  },
];

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { can } = useAuth();
  return (
    <nav className="thin-scroll flex-1 space-y-5 overflow-y-auto px-3 py-4">
      {can('pos.use') && (
        <Link to="/pos" className="flex items-center justify-center gap-2 rounded-lg bg-brand-600 px-3 py-2.5 text-sm font-semibold text-white shadow-lg shadow-brand-900/40 hover:bg-brand-500">
          <ShoppingCart className="size-4" /> Buka Layar Kasir
        </Link>
      )}
      {NAV.map((group) => {
        const items = group.items.filter((i) => can(i.perm));
        if (!items.length) return null;
        return (
          <div key={group.title}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold tracking-[0.14em] text-slate-500 uppercase">{group.title}</p>
            <ul className="space-y-0.5">
              {items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cx(
                        'flex items-center gap-3 rounded-lg px-3 py-2 text-[13px] font-medium transition',
                        isActive ? 'bg-white/10 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-slate-100',
                      )
                    }
                  >
                    <item.icon className="size-4 shrink-0" />
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <div className="grid size-9 place-items-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 font-black text-white shadow-inner">N</div>
      <p className="text-sm font-bold text-white">NusaPOS</p>
    </div>
  );
}

export default function Layout() {
  const { user, logout, stores, storeId, setStoreId, can } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);
  const now = useClock(30000);
  const location = useLocation();
  const isHq = user?.store_id === null;

  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col bg-slate-950 lg:flex">
        <Brand />
        <Sidebar />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-950/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col bg-slate-950">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button className="rounded p-1.5 text-slate-400 hover:text-white" onClick={() => setMobileOpen(false)} aria-label="Tutup menu">
                <X className="size-5" />
              </button>
            </div>
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <button className="rounded-lg p-1.5 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Buka menu">
            <Menu className="size-5" />
          </button>
          <div className="flex min-w-0 items-center gap-2">
            <Store className="size-4 shrink-0 text-slate-400" />
            {isHq ? (
              <select
                className="max-w-[16rem] truncate rounded-lg border-0 bg-slate-100 py-1.5 pr-8 pl-2.5 text-sm font-medium text-slate-800 focus:ring-2 focus:ring-brand-500"
                value={storeId ?? ''}
                onChange={(e) => setStoreId(e.target.value ? Number(e.target.value) : null)}
                title="Filter toko untuk seluruh halaman"
              >
                <option value="">Semua Toko (Nasional)</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} — {s.name}
                  </option>
                ))}
              </select>
            ) : (
              <span className="truncate text-sm font-medium text-slate-800">
                {user?.store?.code} — {user?.store?.name}
              </span>
            )}
          </div>
          <div className="ml-auto flex items-center gap-4">
            <span className="hidden text-xs text-slate-500 tabular-nums md:block">
              {now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </span>
            {can('pos.use') && location.pathname !== '/pos' && (
              <Link to="/pos" className="btn btn-sm btn-secondary hidden sm:inline-flex">
                <MonitorSmartphone className="size-4" /> Kasir
              </Link>
            )}
            <div className="flex items-center gap-3 border-l border-slate-200 pl-4">
              <div className="hidden text-right leading-tight sm:block">
                <p className="text-sm font-semibold text-slate-800">{user?.full_name}</p>
                <p className="text-[11px] text-slate-500">{user && ROLE_LABELS[user.role]}</p>
              </div>
              <Link to="/settings" className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700" title="Akun & pengaturan">
                {user?.full_name
                  .split(' ')
                  .map((w) => w[0])
                  .slice(0, 2)
                  .join('')}
              </Link>
              <Link to="/settings" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800" title="Pengaturan">
                <Settings className="size-4" />
              </Link>
              {/* Kasir keluar lewat serah terima shift di layar kasir, bukan dari sini. */}
              {user?.role !== 'CASHIER' && (
                <button className="rounded-lg p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600" onClick={logout} title="Keluar">
                  <LogOut className="size-4" />
                </button>
              )}
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
