import { can } from '@shared/permissions';
import { CalendarClock, Eye, EyeOff, Lock, User } from 'lucide-react';
import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Spinner } from '../components/ui';
import { fmtRange } from '../lib/format';
import { HANDOVER_KEY, useAuth } from '../lib/auth';

const DEMO = [
  { u: 'admin', p: 'admin123', r: 'Super Admin' },
  { u: 'hq', p: 'hq123456', r: 'Kantor Pusat' },
  { u: 'manager.jkt01', p: 'password', r: 'Kepala Toko' },
  { u: 'spv.jkt01', p: 'password', r: 'Supervisor (PIN 123456)' },
  { u: 'kasir1.jkt01', p: 'password', r: 'Kasir' },
  { u: 'gudang.jkt01', p: 'password', r: 'Staf Gudang' },
];

function readHandover(): { terminal_code: string; full_name: string; username: string; start_at: string; end_at: string } | null {
  try {
    const h = JSON.parse(localStorage.getItem(HANDOVER_KEY) ?? 'null');
    return h && new Date(h.end_at.replace(' ', 'T')) > new Date() ? h : null;
  } catch {
    return null;
  }
}

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [handover] = useState(readHandover);
  const [username, setUsername] = useState(handover?.username ?? '');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={can(user.role, 'dashboard.view') ? '/' : '/pos'} replace />;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username.trim(), password);
      localStorage.removeItem(HANDOVER_KEY);
      navigate(can(u.role, 'dashboard.view') ? '/' : '/pos', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <div className="grid size-10 place-items-center rounded-xl bg-brand-600 text-lg font-black text-white">N</div>
          <p className="text-xl font-bold text-slate-900">NusaPOS</p>
        </div>
        <form onSubmit={submit} className="card space-y-4 p-6">
          <h1 className="text-lg font-semibold text-slate-900">Masuk</h1>
          {handover && (
            <div className="flex gap-3 rounded-lg bg-brand-50 px-3 py-2.5 text-sm text-brand-900">
              <CalendarClock className="mt-0.5 size-4 shrink-0" />
              <span>
                Giliran berikutnya di {handover.terminal_code}: <b>{handover.full_name}</b> ({fmtRange(handover.start_at, handover.end_at)})
              </span>
            </div>
          )}
          <label className="block">
            <span className="label">Username</span>
            <div className="relative">
              <User className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input className="input py-2.5 pl-9" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus={!handover} autoComplete="username" required />
            </div>
          </label>
          <label className="block">
            <span className="label">Password</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                className="input py-2.5 pr-10 pl-9"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus={!!handover}
                required
              />
              <button type="button" className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" onClick={() => setShow(!show)} aria-label="Tampilkan password">
                {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </label>
          {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
          <button className="btn btn-primary btn-lg w-full" disabled={busy}>
            {busy && <Spinner />} Masuk
          </button>
        </form>

        {import.meta.env.DEV && (
          <div className="mt-6 rounded-xl border border-dashed border-slate-300 bg-white p-4">
            <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Akun demo (mode pengembangan)</p>
            <div className="grid grid-cols-2 gap-1.5">
              {DEMO.map((d) => (
                <button
                  key={d.u}
                  type="button"
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-left hover:border-brand-300 hover:bg-brand-50"
                  onClick={() => (setUsername(d.u), setPassword(d.p))}
                >
                  <span className="block font-mono text-xs font-semibold text-slate-800">{d.u}</span>
                  <span className="block text-[11px] text-slate-500">{d.r}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
