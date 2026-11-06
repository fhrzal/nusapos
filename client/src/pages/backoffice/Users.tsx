import { HQ_ROLES, ROLE_LABELS, ROLES, type Role } from '@shared/types';
import { KeyRound, Pencil, Plus, UserCog } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { Badge, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, SearchInput, Spinner, Toggle, type Tone } from '../../components/ui';
import { post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtDateTime } from '../../lib/format';
import { useDebounced, useFetch } from '../../lib/hooks';

const ROLE_TONE: Record<Role, Tone> = { SUPER_ADMIN: 'red', HQ_ADMIN: 'violet', STORE_MANAGER: 'blue', SUPERVISOR: 'amber', CASHIER: 'green', INVENTORY: 'cyan' };

function UserForm({ user: target, onClose, onSaved }: { user: any | null; onClose: () => void; onSaved: () => void }) {
  const { user, stores } = useAuth();
  const { toast } = useFeedback();
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isHq = user?.store_id === null;
  const allowedRoles = ROLES.filter((r) => (isHq ? r !== 'SUPER_ADMIN' || user?.role === 'SUPER_ADMIN' : ['CASHIER', 'SUPERVISOR', 'INVENTORY'].includes(r)));

  useEffect(() => {
    if (!target) return;
    setError(null);
    setF(target.id ? { ...target, password: '', pin: '', is_active: !!target.is_active } : { employee_no: '', username: '', full_name: '', role: 'CASHIER', store_id: user?.store_id ?? stores[0]?.id ?? null, password: '', pin: '', is_active: true });
  }, [target, user, stores]);

  const hqRole = HQ_ROLES.includes(f.role);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { employee_no: f.employee_no, username: f.username, full_name: f.full_name, role: f.role, store_id: hqRole ? null : f.store_id, password: f.password, pin: f.pin, is_active: f.is_active };
      if (target.id) await put(`/users/${target.id}`, body);
      else await post('/users', body);
      toast('Pengguna tersimpan');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={!!target} onClose={onClose} title={target?.id ? `Ubah Pengguna — ${target.username}` : 'Tambah Pengguna'} size="lg">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="NIK / No. Karyawan">
          <input className="input font-mono" value={f.employee_no ?? ''} onChange={(e) => setF({ ...f, employee_no: e.target.value.toUpperCase() })} required />
        </Field>
        <Field label="Nama lengkap">
          <input className="input" value={f.full_name ?? ''} onChange={(e) => setF({ ...f, full_name: e.target.value })} required />
        </Field>
        <Field label="Username">
          <input className="input font-mono" value={f.username ?? ''} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} required />
        </Field>
        <Field label="Role">
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {allowedRoles.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </Field>
        {!hqRole && (
          <Field label="Toko penempatan" className="sm:col-span-2">
            <select className="input" value={f.store_id ?? ''} onChange={(e) => setF({ ...f, store_id: Number(e.target.value) })} disabled={!isHq}>
              {stores.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} — {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
        <Field label={target?.id ? 'Reset password (opsional)' : 'Password'} hint="Minimal 8 karakter">
          <input className="input" type="password" value={f.password ?? ''} onChange={(e) => setF({ ...f, password: e.target.value })} required={!target?.id} minLength={8} autoComplete="new-password" />
        </Field>
        <Field label={target?.id ? 'Reset PIN (opsional)' : 'PIN otorisasi (opsional)'} hint="6 digit — wajib untuk supervisor/kepala toko">
          <input className="input font-mono" inputMode="numeric" value={f.pin ?? ''} onChange={(e) => setF({ ...f, pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} />
        </Field>
        {target?.id && (
          <div className="sm:col-span-2">
            <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Akun aktif" description="Akun nonaktif tidak dapat login." />
          </div>
        )}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 sm:col-span-2">{error}</p>}
        <div className="flex justify-end gap-2 sm:col-span-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={busy}>
            {busy && <Spinner />} Simpan
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Users() {
  const { storeId } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState<any | null>(null);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useFetch<any[]>('/users', { q: dq, role, store_id: storeId });

  return (
    <div>
      <PageHeader
        title="Pengguna & Hak Akses"
        description="Akun karyawan, role, dan penempatan toko. Supervisor memerlukan PIN untuk otorisasi."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus className="size-4" /> Tambah Pengguna
          </button>
        }
      />
      <div className="card">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <SearchInput className="min-w-64 flex-1" value={q} onChange={setQ} placeholder="Nama, username, NIK" />
          <select className="input w-auto" value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">Semua role</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>NIK</th>
                  <th>Nama</th>
                  <th>Username</th>
                  <th>Role</th>
                  <th>Toko</th>
                  <th>PIN</th>
                  <th>Login Terakhir</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.map((u) => (
                  <tr key={u.id}>
                    <td className="font-mono text-xs">{u.employee_no}</td>
                    <td className="font-medium">{u.full_name}</td>
                    <td className="font-mono text-xs">{u.username}</td>
                    <td>
                      <Badge tone={ROLE_TONE[u.role as Role]}>{ROLE_LABELS[u.role as Role]}</Badge>
                    </td>
                    <td>{u.store_code ?? <span className="text-slate-500">Kantor Pusat</span>}</td>
                    <td>{u.has_pin ? <KeyRound className="size-4 text-emerald-600" /> : <span className="text-slate-300">—</span>}</td>
                    <td className="text-slate-500">{fmtDateTime(u.last_login_at)}</td>
                    <td>{u.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                    <td>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(u)} aria-label="Ubah">
                        <Pencil className="size-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState icon={UserCog} title="Tidak ada pengguna" />
        )}
      </div>
      <UserForm user={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </div>
  );
}
