import { Pencil, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { NumberInput } from '../../components/shared';
import { Badge, ErrorBox, Field, Loading, Modal, PageHeader, Spinner, Tabs, Toggle } from '../../components/ui';
import { post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { num } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

type Kind = 'categories' | 'suppliers';

const BLANK = {
  categories: { code: '', name: '', is_active: true },
  suppliers: { code: '', name: '', contact_person: '', phone: '', email: '', address: '', payment_terms: 30, is_active: true },
};

function EditModal({ kind, item, onClose, onSaved }: { kind: Kind; item: any | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (item) {
      setF(item.id ? { ...BLANK[kind], ...item, is_active: !!item.is_active } : BLANK[kind]);
      setError(null);
    }
  }, [item, kind]);
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }));
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { id, product_count, ...body } = f;
      if (item.id) await put(`/${kind}/${item.id}`, body);
      else await post(`/${kind}`, body);
      toast('Data tersimpan');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const title = kind === 'categories' ? 'Kategori' : 'Supplier';
  return (
    <Modal open={!!item} onClose={onClose} title={item?.id ? `Ubah ${title}` : `Tambah ${title}`} size={kind === 'suppliers' ? 'lg' : 'sm'}>
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Kode">
          <input className="input font-mono uppercase" value={f.code ?? ''} onChange={(e) => set('code', e.target.value.toUpperCase())} required />
        </Field>
        <Field label="Nama" className={kind === 'categories' ? '' : ''}>
          <input className="input" value={f.name ?? ''} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        {kind === 'suppliers' && (
          <>
            <Field label="Kontak (PIC)">
              <input className="input" value={f.contact_person ?? ''} onChange={(e) => set('contact_person', e.target.value)} />
            </Field>
            <Field label="Telepon">
              <input className="input" value={f.phone ?? ''} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={f.email ?? ''} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Termin Pembayaran (hari)">
              <NumberInput value={f.payment_terms ?? 30} onChange={(v) => set('payment_terms', v)} />
            </Field>
            <Field label="Alamat" className="sm:col-span-2">
              <textarea className="input" rows={2} value={f.address ?? ''} onChange={(e) => set('address', e.target.value)} />
            </Field>
          </>
        )}
        {item?.id && (
          <div className="sm:col-span-2">
            <Toggle checked={!!f.is_active} onChange={(v) => set('is_active', v)} label="Aktif" />
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

export default function MasterData() {
  const { can } = useAuth();
  const [tab, setTab] = useState<Kind>('categories');
  const [editing, setEditing] = useState<any | null>(null);
  const { data, error, loading, reload } = useFetch<any[]>(`/${tab}`);
  const manage = can('products.manage');

  return (
    <div>
      <PageHeader
        title="Kategori & Supplier"
        description="Data induk pengelompokan produk dan pemasok."
        actions={
          manage && (
            <button className="btn btn-primary" onClick={() => setEditing({})}>
              <Plus className="size-4" /> Tambah {tab === 'categories' ? 'Kategori' : 'Supplier'}
            </button>
          )
        }
      />
      <div className="card">
        <div className="px-4 pt-2">
          <Tabs
            tabs={[
              { key: 'categories', label: 'Kategori' },
              { key: 'suppliers', label: 'Supplier' },
            ]}
            value={tab}
            onChange={setTab}
          />
        </div>
        {error && <ErrorBox message={error} onRetry={reload} />}
        {loading && !data ? (
          <Loading />
        ) : (
          <div className="overflow-x-auto">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Kode</th>
                  <th>Nama</th>
                  {tab === 'suppliers' && (
                    <>
                      <th>Kontak</th>
                      <th>Telepon / Email</th>
                      <th className="num">Termin</th>
                    </>
                  )}
                  <th className="num">Produk Aktif</th>
                  <th>Status</th>
                  {manage && <th />}
                </tr>
              </thead>
              <tbody>
                {data?.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono text-xs font-semibold">{r.code}</td>
                    <td className="font-medium">{r.name}</td>
                    {tab === 'suppliers' && (
                      <>
                        <td>{r.contact_person}</td>
                        <td className="text-slate-600">
                          {r.phone}
                          <div className="text-xs">{r.email}</div>
                        </td>
                        <td className="num">{r.payment_terms} hari</td>
                      </>
                    )}
                    <td className="num">{num(r.product_count)}</td>
                    <td>{r.is_active ? <Badge tone="green">Aktif</Badge> : <Badge>Nonaktif</Badge>}</td>
                    {manage && (
                      <td>
                        <button className="btn btn-sm btn-ghost" onClick={() => setEditing(r)} aria-label="Ubah">
                          <Pencil className="size-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <EditModal kind={tab} item={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </div>
  );
}
