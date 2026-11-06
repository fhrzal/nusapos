import { STORE_TYPE_LABELS, type StoreType } from '@shared/types';
import { Monitor, Pencil, Plus, Store } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { Badge, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Spinner, Toggle } from '../../components/ui';
import { post, put } from '../../lib/api';
import { num } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

function StoreForm({ store, onClose, onSaved }: { store: any | null; onClose: () => void; onSaved: () => void }) {
  const { toast } = useFeedback();
  const [f, setF] = useState<any>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (store) {
      setF(store.id ? { ...store, is_active: !!store.is_active } : { code: '', name: '', type: 'MINIMARKET', address: '', city: '', phone: '', is_active: true });
      setError(null);
    }
  }, [store]);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const body = { code: f.code, name: f.name, type: f.type, address: f.address, city: f.city, phone: f.phone, is_active: f.is_active };
      if (store.id) await put(`/stores/${store.id}`, body);
      else await post('/stores', body);
      toast('Data toko tersimpan');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={!!store} onClose={onClose} title={store?.id ? 'Ubah Toko' : 'Tambah Toko'} size="lg">
      <form onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <Field label="Kode toko" hint="Dipakai di nomor struk & dokumen, mis. JKT03">
          <input className="input font-mono uppercase" value={f.code ?? ''} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} maxLength={10} required />
        </Field>
        <Field label="Format toko">
          <select className="input" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
            {Object.entries(STORE_TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Nama toko" className="sm:col-span-2">
          <input className="input" value={f.name ?? ''} onChange={(e) => setF({ ...f, name: e.target.value })} required />
        </Field>
        <Field label="Alamat" className="sm:col-span-2">
          <input className="input" value={f.address ?? ''} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </Field>
        <Field label="Kota">
          <input className="input" value={f.city ?? ''} onChange={(e) => setF({ ...f, city: e.target.value })} />
        </Field>
        <Field label="Telepon">
          <input className="input" value={f.phone ?? ''} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </Field>
        {store?.id && (
          <div className="sm:col-span-2">
            <Toggle checked={!!f.is_active} onChange={(v) => setF({ ...f, is_active: v })} label="Toko aktif" />
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

function Terminals({ store }: { store: any }) {
  const { toast } = useFeedback();
  const { data, reload } = useFetch<any[]>(`/stores/${store.id}/terminals`);
  const [editing, setEditing] = useState<any | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = { code: editing.code, name: editing.name, is_active: editing.is_active !== 0 && editing.is_active !== false };
      if (editing.id) await put(`/terminals/${editing.id}`, body);
      else await post(`/stores/${store.id}/terminals`, body);
      toast('Terminal tersimpan');
      setEditing(null);
      reload();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {data?.map((t) => (
        <button key={t.id} onClick={() => setEditing(t)} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-1 text-xs hover:border-brand-300" title={t.name}>
          <Monitor className={t.is_active ? 'size-3.5 text-brand-600' : 'size-3.5 text-slate-300'} />
          <span className="font-mono">{t.code}</span>
        </button>
      ))}
      <button className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-xs text-slate-500 hover:border-brand-400 hover:text-brand-600" onClick={() => setEditing({ code: `POS-${String((data?.length ?? 0) + 1).padStart(2, '0')}`, name: `Kasir ${(data?.length ?? 0) + 1}` })}>
        + Terminal
      </button>
      <Modal open={!!editing} onClose={() => setEditing(null)} size="sm" title={editing?.id ? 'Ubah Terminal' : `Terminal Baru — ${store.code}`}>
        <form onSubmit={save} className="space-y-3">
          <Field label="Kode">
            <input className="input font-mono uppercase" value={editing?.code ?? ''} onChange={(e) => setEditing({ ...editing, code: e.target.value.toUpperCase() })} required />
          </Field>
          <Field label="Nama">
            <input className="input" value={editing?.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required />
          </Field>
          {editing?.id && <Toggle checked={!!editing.is_active} onChange={(v) => setEditing({ ...editing, is_active: v })} label="Terminal aktif" />}
          <button className="btn btn-primary w-full">Simpan</button>
        </form>
      </Modal>
    </div>
  );
}

export default function Stores() {
  const { data, error, loading, reload } = useFetch<any[]>('/stores', { all: 1 });
  const [editing, setEditing] = useState<any | null>(null);
  return (
    <div>
      <PageHeader
        title="Toko & Terminal"
        description="Jaringan toko dan perangkat kasir (terminal) di setiap toko."
        actions={
          <button className="btn btn-primary" onClick={() => setEditing({})}>
            <Plus className="size-4" /> Tambah Toko
          </button>
        }
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {data.map((s) => (
            <div key={s.id} className="card p-5">
              <div className="flex items-start gap-4">
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Store className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold text-slate-500">{s.code}</span>
                    <Badge tone="blue">{STORE_TYPE_LABELS[s.type as StoreType]}</Badge>
                    {!s.is_active && <Badge>Nonaktif</Badge>}
                  </div>
                  <p className="mt-0.5 font-semibold text-slate-900">{s.name}</p>
                  <p className="text-sm text-slate-500">
                    {s.address}
                    {s.city && `, ${s.city}`} · {s.phone}
                  </p>
                  <p className="mt-2 text-xs text-slate-500">{num(s.user_count)} karyawan aktif</p>
                  <div className="mt-3">
                    <Terminals store={s} />
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)} aria-label="Ubah">
                  <Pencil className="size-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Store} title="Belum ada toko" />
      )}
      <StoreForm store={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), reload())} />
    </div>
  );
}
