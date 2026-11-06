import { ROLE_LABELS } from '@shared/types';
import { Building2, KeyRound, Receipt as ReceiptIcon, ShieldCheck, Star } from 'lucide-react';
import { useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { NumberInput } from '../../components/shared';
import { Field, InfoRow, Loading, PageHeader, Spinner, Toggle } from '../../components/ui';
import { post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { rp } from '../../lib/format';
import { useFetch } from '../../lib/hooks';

function Section({ icon: Icon, title, description, children }: { icon: typeof Building2; title: string; description: string; children: React.ReactNode }) {
  return (
    <div className="card grid gap-6 p-6 lg:grid-cols-[260px_1fr]">
      <div>
        <Icon className="size-5 text-brand-600" />
        <h2 className="mt-2 font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-sm text-slate-500">{description}</p>
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function CompanySettings() {
  const { toast } = useFeedback();
  const { data, setData } = useFetch<any>('/settings');
  const [busy, setBusy] = useState(false);
  if (!data) return <Loading />;
  const set = (k: string, v: unknown) => setData({ ...data, [k]: v });
  const save = async () => {
    setBusy(true);
    try {
      setData(await put('/settings', data));
      toast('Pengaturan disimpan & berlaku untuk seluruh toko');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Section icon={Building2} title="Profil Perusahaan" description="Ditampilkan pada struk, PO, dan dokumen resmi.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nama badan usaha">
            <input className="input" value={data.company_name} onChange={(e) => set('company_name', e.target.value)} />
          </Field>
          <Field label="Nama brand / toko">
            <input className="input" value={data.company_brand} onChange={(e) => set('company_brand', e.target.value)} />
          </Field>
          <Field label="NPWP">
            <input className="input font-mono" value={data.company_npwp} onChange={(e) => set('company_npwp', e.target.value)} />
          </Field>
          <Field label="Tarif PPN (%)" hint="Harga jual diperlakukan sudah termasuk PPN">
            <NumberInput value={data.tax_rate} onChange={(v) => set('tax_rate', v)} decimals={2} />
          </Field>
          <Field label="Alamat kantor pusat" className="sm:col-span-2">
            <input className="input" value={data.company_address} onChange={(e) => set('company_address', e.target.value)} />
          </Field>
        </div>
      </Section>
      <Section icon={ReceiptIcon} title="Kasir & Struk" description="Perilaku layar kasir dan otorisasi.">
        <Field label="Footer struk" hint="Satu baris per kalimat">
          <textarea className="input font-mono text-xs" rows={3} value={data.receipt_footer} onChange={(e) => set('receipt_footer', e.target.value)} />
        </Field>
        <Field label="Batas uang di laci" hint="Kasir mendapat peringatan untuk melakukan pickup setoran">
          <NumberInput value={data.max_drawer_cash} onChange={(v) => set('max_drawer_cash', v)} />
        </Field>
        <Field label="Modal laci standar" hint="Dipakai saat shift dibuka otomatis dari jadwal">
          <NumberInput value={data.opening_cash_default} onChange={(v) => set('opening_cash_default', v)} />
        </Field>
        <Toggle
          checked={data.enforce_schedule}
          onChange={(v) => set('enforce_schedule', v)}
          label="Kasir wajib sesuai jadwal"
          description="Kasir hanya bisa membuka shift di terminal & jam yang dijadwalkan kepala toko. Supervisor tetap bisa membuka shift cadangan."
        />
        <Toggle checked={data.auto_print_receipt} onChange={(v) => set('auto_print_receipt', v)} label="Cetak struk otomatis" description="Struk langsung dikirim ke printer setelah pembayaran." />
        <Toggle checked={data.void_requires_approval} onChange={(v) => set('void_requires_approval', v)} label="Hapus item & batal transaksi wajib otorisasi supervisor" description="Direkomendasikan untuk mencegah fraud kasir." />
        <Toggle checked={data.allow_negative_stock} onChange={(v) => set('allow_negative_stock', v)} label="Izinkan penjualan saat stok sistem kosong" description="Jika nonaktif, transaksi ditolak bila stok tidak mencukupi." />
      </Section>
      <Section icon={Star} title="Program Poin Member" description="Aturan perolehan dan penukaran poin.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Belanja per 1 poin (Rp)" hint={`Belanja ${rp(data.points_per_amount)} = 1 poin`}>
            <NumberInput value={data.points_per_amount} onChange={(v) => set('points_per_amount', v)} />
          </Field>
          <Field label="Nilai tukar 1 poin (Rp)" hint={`Cashback efektif ${((data.point_value / (data.points_per_amount || 1)) * 100).toFixed(2)}%`}>
            <NumberInput value={data.point_value} onChange={(v) => set('point_value', v)} />
          </Field>
        </div>
      </Section>
      <div className="flex justify-end">
        <button className="btn btn-primary btn-lg" onClick={save} disabled={busy}>
          {busy && <Spinner />} Simpan Pengaturan
        </button>
      </div>
    </>
  );
}

function AccountSettings() {
  const { user } = useAuth();
  const { toast } = useFeedback();
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [pin, setPin] = useState({ current_password: '', new_pin: '' });
  const [busy, setBusy] = useState<string | null>(null);

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pw.new_password !== pw.confirm) return toast('Konfirmasi password tidak sama', 'error');
    setBusy('pw');
    try {
      await post('/auth/change-password', { current_password: pw.current_password, new_password: pw.new_password });
      toast('Password berhasil diubah');
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const changePin = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy('pin');
    try {
      await post('/auth/change-pin', pin);
      toast('PIN otorisasi berhasil diubah');
      setPin({ current_password: '', new_pin: '' });
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Section icon={ShieldCheck} title="Akun Saya" description="Ubah password login dan PIN otorisasi Anda.">
      <div className="rounded-lg bg-slate-50 p-4">
        <InfoRow label="Nama">{user?.full_name}</InfoRow>
        <InfoRow label="Username">{user?.username}</InfoRow>
        <InfoRow label="NIK">{user?.employee_no}</InfoRow>
        <InfoRow label="Role">{user && ROLE_LABELS[user.role]}</InfoRow>
        <InfoRow label="Toko">{user?.store ? `${user.store.code} — ${user.store.name}` : 'Kantor Pusat'}</InfoRow>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <form onSubmit={changePassword} className="space-y-3">
          <p className="text-sm font-semibold text-slate-800">Ganti password</p>
          <input className="input" type="password" placeholder="Password saat ini" value={pw.current_password} onChange={(e) => setPw({ ...pw, current_password: e.target.value })} required autoComplete="current-password" />
          <input className="input" type="password" placeholder="Password baru (min. 8)" value={pw.new_password} onChange={(e) => setPw({ ...pw, new_password: e.target.value })} required minLength={8} autoComplete="new-password" />
          <input className="input" type="password" placeholder="Ulangi password baru" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} required autoComplete="new-password" />
          <button className="btn btn-secondary" disabled={busy === 'pw'}>
            {busy === 'pw' && <Spinner />} Simpan Password
          </button>
        </form>
        <form onSubmit={changePin} className="space-y-3">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
            <KeyRound className="size-4" /> Ganti PIN otorisasi
          </p>
          <input className="input" type="password" placeholder="Password saat ini" value={pin.current_password} onChange={(e) => setPin({ ...pin, current_password: e.target.value })} required />
          <input className="input font-mono tracking-[0.4em]" type="password" inputMode="numeric" placeholder="PIN baru 6 digit" value={pin.new_pin} onChange={(e) => setPin({ ...pin, new_pin: e.target.value.replace(/\D/g, '').slice(0, 6) })} required />
          <button className="btn btn-secondary" disabled={busy === 'pin' || pin.new_pin.length !== 6}>
            {busy === 'pin' && <Spinner />} Simpan PIN
          </button>
        </form>
      </div>
    </Section>
  );
}

export default function Settings() {
  const { can } = useAuth();
  return (
    <div className="space-y-5">
      <PageHeader title="Pengaturan" description={can('settings.manage') ? 'Konfigurasi perusahaan, kasir, dan akun Anda.' : 'Pengaturan akun Anda.'} />
      <AccountSettings />
      {can('settings.manage') && <CompanySettings />}
    </div>
  );
}
