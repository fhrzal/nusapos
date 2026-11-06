import type { Permission } from '@shared/permissions';
import { ShieldOff } from 'lucide-react';
import { lazy, Suspense, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { FeedbackProvider } from './components/Feedback';
import Layout from './components/Layout';
import { PrintProvider } from './components/Print';
import { EmptyState, Loading } from './components/ui';
import { AuthProvider, useAuth } from './lib/auth';
import Login from './pages/Login';

const PosPage = lazy(() => import('./pages/pos/PosPage'));
const Dashboard = lazy(() => import('./pages/backoffice/Dashboard'));
const Sales = lazy(() => import('./pages/backoffice/Sales'));
const Shifts = lazy(() => import('./pages/backoffice/Shifts'));
const Schedules = lazy(() => import('./pages/backoffice/Schedules'));
const Reports = lazy(() => import('./pages/backoffice/Reports'));
const Products = lazy(() => import('./pages/backoffice/Products'));
const MasterData = lazy(() => import('./pages/backoffice/MasterData'));
const Promotions = lazy(() => import('./pages/backoffice/Promotions'));
const PriceLabels = lazy(() => import('./pages/backoffice/PriceLabels'));
const Stock = lazy(() => import('./pages/backoffice/inventory/Stock'));
const Receipts = lazy(() => import('./pages/backoffice/inventory/Receipts'));
const Transfers = lazy(() => import('./pages/backoffice/inventory/Transfers'));
const Adjustments = lazy(() => import('./pages/backoffice/inventory/Adjustments'));
const Movements = lazy(() => import('./pages/backoffice/inventory/Movements'));
const Purchasing = lazy(() => import('./pages/backoffice/Purchasing'));
const Members = lazy(() => import('./pages/backoffice/Members'));
const Users = lazy(() => import('./pages/backoffice/Users'));
const Stores = lazy(() => import('./pages/backoffice/Stores'));
const AuditLog = lazy(() => import('./pages/backoffice/AuditLog'));
const Settings = lazy(() => import('./pages/backoffice/Settings'));

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Memeriksa sesi…" />;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm: Permission; children: ReactNode }) {
  const { can } = useAuth();
  if (!can(perm)) return <EmptyState icon={ShieldOff} title="Akses ditolak" description="Role Anda tidak memiliki izin untuk membuka halaman ini." />;
  return <>{children}</>;
}

function Home() {
  const { can } = useAuth();
  if (can('dashboard.view')) return <Dashboard />;
  return <Navigate to={can('pos.use') ? '/pos' : '/settings'} replace />;
}

const page = (perm: Permission, el: ReactNode) => <Guard perm={perm}>{el}</Guard>;

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <FeedbackProvider>
          <PrintProvider>
            <Suspense fallback={<Loading />}>
              <Routes>
                <Route path="/login" element={<Login />} />
                <Route path="/pos" element={<RequireAuth>{page('pos.use', <PosPage />)}</RequireAuth>} />
                <Route
                  element={
                    <RequireAuth>
                      <Layout />
                    </RequireAuth>
                  }
                >
                  <Route index element={<Home />} />
                  <Route path="sales" element={page('sales.view', <Sales />)} />
                  <Route path="shifts" element={page('shifts.view', <Shifts />)} />
                  <Route path="schedules" element={page('schedules.manage', <Schedules />)} />
                  <Route path="reports" element={page('reports.view', <Reports />)} />
                  <Route path="products" element={page('products.view', <Products />)} />
                  <Route path="master" element={page('products.view', <MasterData />)} />
                  <Route path="promotions" element={page('promotions.manage', <Promotions />)} />
                  <Route path="labels" element={page('products.view', <PriceLabels />)} />
                  <Route path="inventory/stock" element={page('inventory.view', <Stock />)} />
                  <Route path="inventory/receipts" element={page('inventory.view', <Receipts />)} />
                  <Route path="inventory/transfers" element={page('inventory.view', <Transfers />)} />
                  <Route path="inventory/adjustments" element={page('inventory.view', <Adjustments />)} />
                  <Route path="inventory/movements" element={page('inventory.view', <Movements />)} />
                  <Route path="purchasing" element={page('inventory.view', <Purchasing />)} />
                  <Route path="members" element={page('members.view', <Members />)} />
                  <Route path="users" element={page('users.manage', <Users />)} />
                  <Route path="stores" element={page('stores.manage', <Stores />)} />
                  <Route path="audit" element={page('audit.view', <AuditLog />)} />
                  <Route path="settings" element={<Settings />} />
                  <Route path="*" element={<EmptyState title="Halaman tidak ditemukan" />} />
                </Route>
              </Routes>
            </Suspense>
          </PrintProvider>
        </FeedbackProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
