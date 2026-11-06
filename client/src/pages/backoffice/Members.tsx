import { MEMBER_TIERS } from '@shared/types';
import { Coins, Pencil, Plus, UserPlus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { StatusBadge } from '../../components/shared';
import { Badge, EmptyState, ErrorBox, Field, InfoRow, Loading, Modal, PageHeader, Pagination, SearchInput, Spinner, StatCard, Toggle, type Tone } from '../../components/ui';
import { post, put, type Paged } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { compactRp, fmtDate, fmtDateTime, money, num, rp } from '../../lib/format';
import { useDebounced, useFetch } from '../../lib/hooks';
import { SaleDetailModal } from './Sales';

const TIER_TONE: Record<string, Tone> = { REGULAR: 'gray', SILVER: 'cyan', GOLD: 'amber', PLATINUM: 'violet' };

function MemberForm({ member, onClose, onSaved }: { member: any | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (member) {
      setF(member.id ? { ...member, email: member.email ?? '', birth_date: member.birth_date ?? '', is_active: !!member.is_active } : { name: '', phone: '', email: '', birth_date: '', tier: 'REGULAR' });
      setError(null);
    }
  }, [member]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { name: f.name, phone: f.phone, email: f.email, birth_date: f.birth_date, tier: f.tier, is_active: f.is_active };
      if (member.id) await put(`/members/${member.id}`, body);
      else await post('/members', body);
      toast('Data member tersimpan');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!member} onClose={onClose} title={member?.id ? 'Ubah Member' : 'Daftarkan Member'} size="md">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Nama lengkap" className="sm:col-span-2">
          <input className="input" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="No. HP">
          <input className="input font-mono" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} required />
        </Field>
        <Field label="Email">
          <input className="input" type="email" value={f.email ?? ''} onChange={(e) => setF({ ...f, email: e.target.value })} />
        </Field>
        <Field label="Tanggal lahir">
          <input className="input" type="date" value={f.birth_date ?? ''} onChange={(e) => setF({ ...f, birth_date: e.target.value })} />
        </Field>
        <Field label="Tier">
          <select className="input" value={f.tier ?? 'REGULAR'} onChange={(e) => setF({ ...f, tier: e.target.value })}>
            {MEMBER_TIERS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </Field>
        {member?.id && (
          <div className="sm:col-span-2">
            <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Member aktif" />
          </div>
        )}
        {error && <p className="text-sm text-rose-600 sm:col-span-2">{error}</p>}
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

function MemberDetail({ id, onClose, onEdit }: { id: number | null; onClose: () => void; onEdit: (m: any) => void }) {
  const { can } = useAuth();
  const { data: m, error } = useFetch<any>(id ? `/members/${id}` : null);
  const [sale, setSale] = useState<number | null>(null);
  return (
    <>
      <Modal
        open={!!id && !sale}
        onClose={onClose}
        size="xl"
        title={m?.name ?? 'Member'}
        subtitle={m && `${m.member_no} · ${m.phone}`}
        footer={
          m &&
          can('members.manage') && (
            <button className="btn btn-primary" onClick={() => onEdit(m)}>
              <Pencil className="size-4" /> Ubah
            </button>
          )
        }
      >
        {error && <ErrorBox message={error} />}
        {!m ? (
          <Loading />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
            <div className="space-y-4">
              <div className="rounded-xl bg-gradient-to-br from-slate-900 to-brand-900 p-5 text-white">
                <p className="text-xs tracking-widest text-slate-300 uppercase">Member {m.tier}</p>
                <p className="mt-3 font-mono tracking-wider">{m.member_no.replace(/(\d{4})/g, '$1 ')}</p>
                <p className="mt-4 text-xs text-slate-300">Saldo poin</p>
                <p className="font-mono text-3xl font-bold">{money(m.points)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 p-4">
                <InfoRow label="Total belanja">{rp(m.total_spent)}</InfoRow>
                <InfoRow label="Bergabung">{fmtDate(m.joined_at)}</InfoRow>
                <InfoRow label="Email">{m.email ?? '—'}</InfoRow>
                <InfoRow label="Tgl lahir">{fmtDate(m.birth_date)}</InfoRow>
              </div>
            </div>
            <div className="space-y-5">
              <div>
                <p className="label">Transaksi terakhir</p>
                <table className="tbl rounded-lg border border-slate-200">
                  <tbody>
                    {m.sales.map((s: any) => (
                      <tr key={s.id} className={can('sales.view') ? 'cursor-pointer hover:bg-slate-50' : ''} onClick={() => can('sales.view') && setSale(s.id)}>
                        <td className="font-mono text-xs">{s.receipt_no}</td>
                        <td className="text-slate-500">{fmtDateTime(s.created_at)}</td>
                        <td>{s.store_code}</td>
                        <td className="num text-emerald-600">+{s.points_earned}</td>
                        <td className="num font-semibold">{money(s.total)}</td>
                        <td>{s.status !== 'COMPLETED' && <StatusBadge status={s.status} />}</td>
                      </tr>
                    ))}
                    {!m.sales.length && (
                      <tr>
                        <td className="py-6 text-center text-slate-500">Belum ada transaksi</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div>
                <p className="label">Mutasi poin</p>
                <table className="tbl rounded-lg border border-slate-200">
                  <tbody>
                    {m.ledger.map((l: any) => (
                      <tr key={l.id}>
                        <td className="text-slate-500">{fmtDateTime(l.created_at)}</td>
                        <td>
                          <Badge tone={l.points > 0 ? 'green' : 'red'}>{l.type}</Badge>
                        </td>
                        <td className="font-mono text-xs">{l.ref_no ?? l.note}</td>
                        <td className={l.points > 0 ? 'num text-emerald-600' : 'num text-rose-600'}>
                          {l.points > 0 ? '+' : ''}
                          {money(l.points)}
                        </td>
                        <td className="num text-slate-600">{money(l.balance_after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <SaleDetailModal id={sale} onClose={() => setSale(null)} />
    </>
  );
}

export default function Members() {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [tier, setTier] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<any | null>(null);
  const [detail, setDetail] = useState<number | null>(null);
  const dq = useDebounced(q);
  const { data, error, loading, reload } = useFetch<Paged<any>>('/members', { q: dq, tier, page, limit: 25 });
  const s = data?.stats;

  return (
    <div>
      <PageHeader
        title="Member & Loyalitas"
        description="Program poin pelanggan: belanja mendapat poin, poin dapat dipakai sebagai alat bayar."
        actions={
          can('members.manage') && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <Plus className="size-4" /> Daftarkan Member
            </button>
          )
        }
      />
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Member Aktif" value={num(s?.total)} icon={Users} />
        <StatCard label="Member Baru 30 Hari" value={num(s?.new_30d)} icon={UserPlus} tone="green" />
        <StatCard label="Poin Beredar" value={num(s?.points)} icon={Coins} tone="amber" sub="kewajiban loyalitas" />
        <StatCard label="Total Belanja Member" value={compactRp(s?.spent ?? 0)} tone="violet" />
      </div>
      <div className="card">
        <div className="flex flex-wrap gap-3 border-b border-slate-100 p-4">
          <SearchInput className="min-w-64 flex-1" value={q} onChange={(v) => (setQ(v), setPage(1))} placeholder="Nama, no. HP, atau no. kartu" />
          <select className="input w-auto" value={tier} onChange={(e) => (setTier(e.target.value), setPage(1))}>
            <option value="">Semua tier</option>
            {MEMBER_TIERS.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : data?.data.length ? (
          <>
            <div className="overflow-x-auto">
              <table className="tbl tbl-hover">
                <thead>
                  <tr>
                    <th>No. Member</th>
                    <th>Nama</th>
                    <th>No. HP</th>
                    <th>Tier</th>
                    <th className="num">Poin</th>
                    <th className="num">Total Belanja</th>
                    <th>Bergabung</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((m) => (
                    <tr key={m.id} onClick={() => setDetail(m.id)}>
                      <td className="font-mono text-xs">{m.member_no}</td>
                      <td className="font-medium">{m.name}</td>
                      <td className="font-mono text-xs text-slate-600">{m.phone}</td>
                      <td>
                        <Badge tone={TIER_TONE[m.tier]}>{m.tier}</Badge>
                      </td>
                      <td className="num font-semibold">{money(m.points)}</td>
                      <td className="num">{money(m.total_spent)}</td>
                      <td className="text-slate-500">{fmtDate(m.joined_at)}</td>
                      <td>{m.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} limit={25} total={data.total} onChange={setPage} />
          </>
        ) : (
          <EmptyState icon={Users} title="Member tidak ditemukan" />
        )}
      </div>
      <MemberForm member={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
      <MemberDetail id={detail} onClose={() => setDetail(null)} onEdit={(m) => (setDetail(null), setEditing(m))} />
    </div>
  );
}
