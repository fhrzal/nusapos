import { ROLE_LABELS, type Role } from '@shared/types';
import { CalendarClock, ChevronLeft, ChevronRight, Copy, Plus, Store, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useFeedback } from '../../components/Feedback';
import { Badge, cx, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Spinner } from '../../components/ui';
import { api, post, put } from '../../lib/api';
import { useAuth } from '../../lib/auth';
import { fmtRange, isoDate } from '../../lib/format';
import { useClock, useFetch } from '../../lib/hooks';

const PRESETS = [
  { label: 'Pagi', start: '07:00', end: '15:00' },
  { label: 'Siang', start: '15:00', end: '23:00' },
  { label: 'Malam', start: '23:00', end: '07:00' },
];

interface ScheduleRow {
  id: number;
  terminal_id: number;
  terminal_code: string;
  user_id: number;
  full_name: string;
  role: Role;
  start_at: string;
  end_at: string;
  note: string | null;
  shift_id: number | null;
  shift_status: 'OPEN' | 'CLOSED' | null;
}

interface Options {
  terminals: { id: number; code: string; name: string }[];
  users: { id: number; full_name: string; employee_no: string; role: Role }[];
}

function addDaysIso(date: string, n: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function mondayOf(d: Date) {
  const x = new Date(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return isoDate(x);
}

const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('id-ID', { weekday: 'short', day: '2-digit', month: '2-digit' });

function status(s: ScheduleRow, nowStr: string): { label: string; className: string } {
  if (s.shift_status === 'OPEN') return { label: 'Shift berjalan', className: 'border-emerald-300 bg-emerald-50 text-emerald-800' };
  if (s.shift_status === 'CLOSED') return { label: 'Selesai', className: 'border-slate-200 bg-slate-100 text-slate-500' };
  if (s.end_at <= nowStr) return { label: 'Tidak dibuka', className: 'border-rose-200 bg-rose-50 text-rose-700' };
  if (s.start_at <= nowStr) return { label: 'Belum buka shift', className: 'border-amber-300 bg-amber-50 text-amber-800' };
  return { label: 'Terjadwal', className: 'border-brand-200 bg-brand-50 text-brand-800' };
}

interface FormState {
  id?: number;
  terminal_id: number | null;
  user_id: number | null;
  dates: string[];
  start_time: string;
  end_time: string;
  note: string;
  locked?: boolean;
}

function ScheduleForm({ form, week, options, onClose, onSaved }: { form: FormState | null; week: string[]; options: Options | undefined; onClose: () => void; onSaved: () => void }) {
  const { toast, confirm } = useFeedback();
  const [f, setF] = useState<FormState | null>(form);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setF(form);
    setError(null);
  }, [form]);
  if (!f) return null;
  const set = (patch: Partial<FormState>) => setF({ ...f, ...patch });
  const overnight = f.end_time <= f.start_time;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body = { terminal_id: f.terminal_id, user_id: f.user_id, dates: f.dates, start_time: f.start_time, end_time: f.end_time, note: f.note || null };
      if (f.id) await put(`/schedules/${f.id}`, body);
      else await post('/schedules', body);
      toast(f.id ? 'Jadwal diperbarui' : `${f.dates.length} jadwal ditambahkan`);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirm({ title: 'Hapus jadwal ini?', danger: true, confirmLabel: 'Hapus' }))) return;
    try {
      await api(`/schedules/${f.id}`, { method: 'DELETE' });
      toast('Jadwal dihapus');
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal open={!!form} onClose={onClose} size="md" title={f.id ? 'Ubah Jadwal' : 'Tambah Jadwal'}>
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Terminal">
            <select className="input" value={f.terminal_id ?? ''} onChange={(e) => set({ terminal_id: Number(e.target.value) || null })} disabled={f.locked} required>
              <option value="">— Pilih —</option>
              {options?.terminals.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} — {t.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Petugas">
            <select className="input" value={f.user_id ?? ''} onChange={(e) => set({ user_id: Number(e.target.value) || null })} disabled={f.locked} required>
              <option value="">— Pilih —</option>
              {options?.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name} · {ROLE_LABELS[u.role]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {f.id ? (
          <Field label="Tanggal">
            <input type="date" className="input" value={f.dates[0]} onChange={(e) => set({ dates: [e.target.value] })} required />
          </Field>
        ) : (
          <Field label="Hari (bisa lebih dari satu)">
            <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
              {week.map((d) => {
                const on = f.dates.includes(d);
                return (
                  <button
                    type="button"
                    key={d}
                    onClick={() => set({ dates: on ? f.dates.filter((x) => x !== d) : [...f.dates, d] })}
                    className={cx('rounded-lg border px-1 py-1.5 text-xs font-medium', on ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-slate-200 text-slate-600')}
                  >
                    {dayLabel(d)}
                  </button>
                );
              })}
            </div>
          </Field>
        )}
        <Field label="Jam" hint={overnight ? 'Selesai keesokan harinya' : undefined}>
          <div className="mb-2 flex gap-2">
            {PRESETS.map((p) => (
              <button
                type="button"
                key={p.label}
                onClick={() => set({ start_time: p.start, end_time: p.end })}
                className={cx('btn btn-sm flex-1', f.start_time === p.start && f.end_time === p.end ? 'btn-primary' : 'btn-secondary')}
              >
                {p.label} {p.start}–{p.end}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input type="time" className="input" value={f.start_time} onChange={(e) => set({ start_time: e.target.value })} required />
            <span className="text-slate-400">s.d.</span>
            <input type="time" className="input" value={f.end_time} onChange={(e) => set({ end_time: e.target.value })} required />
          </div>
        </Field>
        <Field label="Catatan (opsional)">
          <input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={100} />
        </Field>
        {f.locked && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">Shift dari jadwal ini sudah dibuka; hanya jam yang dapat diubah.</p>}
        {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
        <div className="flex gap-2">
          {f.id && !f.locked && (
            <button type="button" className="btn btn-ghost text-rose-600" onClick={remove}>
              <Trash2 className="size-4" /> Hapus
            </button>
          )}
          <button type="button" className="btn btn-secondary ml-auto" onClick={onClose}>
            Batal
          </button>
          <button className="btn btn-primary" disabled={busy || !f.dates.length}>
            {busy && <Spinner />} Simpan
          </button>
        </div>
      </form>
    </Modal>
  );
}

export default function Schedules() {
  const { storeId, stores } = useAuth();
  const { toast, confirm } = useFeedback();
  const now = useClock(60_000);
  const nowStr = `${isoDate(now)} ${now.toTimeString().slice(0, 8)}`;
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const week = useMemo(() => Array.from({ length: 7 }, (_, i) => addDaysIso(weekStart, i)), [weekStart]);
  const { data: rows, error, loading, reload } = useFetch<ScheduleRow[]>(storeId ? '/schedules' : null, { store_id: storeId, from: week[0], to: week[6] });
  const { data: options } = useFetch<Options>(storeId ? '/schedules/options' : null, { store_id: storeId });
  const [form, setForm] = useState<FormState | null>(null);
  const today = isoDate(now);

  if (!storeId)
    return (
      <div>
        <PageHeader title="Jadwal Kasir" />
        <div className="card">
          <EmptyState icon={Store} title="Pilih toko terlebih dahulu" description="Gunakan pilihan toko di bilah atas untuk mengatur jadwal kasirnya." />
        </div>
      </div>
    );

  const onDuty = (rows ?? []).filter((s) => s.start_at <= nowStr && s.end_at > nowStr);
  const copyLastWeek = async () => {
    if (!(await confirm({ title: 'Salin jadwal minggu lalu?', message: 'Jadwal minggu sebelumnya disalin ke minggu ini. Jadwal yang bentrok dilewati.' }))) return;
    try {
      const r = await post<{ created: number; skipped: number }>('/schedules/copy-week', { store_id: storeId, from: addDaysIso(weekStart, -7), to: weekStart });
      toast(`${r.created} jadwal disalin${r.skipped ? `, ${r.skipped} dilewati karena bentrok` : ''}`);
      reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const newForm = (terminalId: number | null, date: string): FormState => ({ terminal_id: terminalId, user_id: null, dates: [date], start_time: '07:00', end_time: '15:00', note: '' });

  return (
    <div className="space-y-4">
      <PageHeader
        title="Jadwal Kasir"
        description={`${stores.find((s) => s.id === storeId)?.name} · kasir hanya dapat membuka shift sesuai jadwal; shift ditutup untuk serah terima saat jamnya berakhir.`}
        actions={
          <>
            <button className="btn btn-secondary" onClick={copyLastWeek}>
              <Copy className="size-4" /> Salin Minggu Lalu
            </button>
            <button className="btn btn-primary" onClick={() => setForm(newForm(options?.terminals[0]?.id ?? null, week.includes(today) ? today : week[0]))}>
              <Plus className="size-4" /> Tambah Jadwal
            </button>
          </>
        }
      />

      <div className="card p-4">
        <p className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">Bertugas sekarang</p>
        {onDuty.length ? (
          <div className="flex flex-wrap gap-2">
            {onDuty.map((s) => {
              const st = status(s, nowStr);
              return (
                <div key={s.id} className={cx('rounded-lg border px-3 py-2 text-sm', st.className)}>
                  <span className="font-mono font-semibold">{s.terminal_code}</span> · {s.full_name} · {fmtRange(s.start_at, s.end_at)} · <b>{st.label}</b>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-slate-500">Tidak ada kasir terjadwal saat ini.</p>
        )}
      </div>

      <div className="card">
        <div className="flex items-center gap-2 border-b border-slate-100 p-4">
          <button className="btn btn-sm btn-secondary" onClick={() => setWeekStart(addDaysIso(weekStart, -7))} aria-label="Minggu sebelumnya">
            <ChevronLeft className="size-4" />
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setWeekStart(mondayOf(new Date()))}>
            Minggu ini
          </button>
          <button className="btn btn-sm btn-secondary" onClick={() => setWeekStart(addDaysIso(weekStart, 7))} aria-label="Minggu berikutnya">
            <ChevronRight className="size-4" />
          </button>
          <span className="ml-2 text-sm font-semibold text-slate-700">
            {new Date(`${week[0]}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long' })} –{' '}
            {new Date(`${week[6]}T00:00:00`).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
        {error && (
          <div className="p-4">
            <ErrorBox message={error} onRetry={reload} />
          </div>
        )}
        {loading && !rows ? (
          <Loading />
        ) : !options?.terminals.length ? (
          <EmptyState icon={CalendarClock} title="Belum ada terminal aktif di toko ini" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[960px] table-fixed text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[11px] tracking-wider text-slate-500 uppercase">
                  <th className="w-24 px-3 py-2.5 text-left">Terminal</th>
                  {week.map((d) => (
                    <th key={d} className={cx('px-2 py-2.5 text-left', d === today && 'bg-brand-50 text-brand-700')}>
                      {dayLabel(d)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {options.terminals.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 align-top last:border-0">
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700">{t.code}</td>
                    {week.map((d) => {
                      const cell = (rows ?? []).filter((s) => s.terminal_id === t.id && s.start_at.slice(0, 10) === d);
                      return (
                        <td key={d} className={cx('group px-1.5 py-1.5', d === today && 'bg-brand-50/40')}>
                          <div className="space-y-1">
                            {cell.map((s) => {
                              const st = status(s, nowStr);
                              return (
                                <button
                                  key={s.id}
                                  title={`${s.full_name} · ${st.label}${s.note ? ` · ${s.note}` : ''}`}
                                  onClick={() =>
                                    setForm({
                                      id: s.id,
                                      terminal_id: s.terminal_id,
                                      user_id: s.user_id,
                                      dates: [s.start_at.slice(0, 10)],
                                      start_time: s.start_at.slice(11, 16),
                                      end_time: s.end_at.slice(11, 16),
                                      note: s.note ?? '',
                                      locked: !!s.shift_id,
                                    })
                                  }
                                  className={cx('block w-full rounded-md border px-2 py-1 text-left text-xs leading-tight', st.className)}
                                >
                                  <span className="block font-mono">{fmtRange(s.start_at, s.end_at)}</span>
                                  <span className="block truncate font-medium">{s.full_name}</span>
                                </button>
                              );
                            })}
                            <button
                              onClick={() => setForm(newForm(t.id, d))}
                              className="w-full rounded-md border border-dashed border-transparent py-0.5 text-xs text-slate-400 group-hover:border-slate-300 hover:text-brand-600"
                            >
                              + jadwal
                            </button>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap gap-3 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
          <Badge tone="blue">Terjadwal</Badge>
          <Badge tone="amber">Belum buka shift</Badge>
          <Badge tone="green">Shift berjalan</Badge>
          <Badge>Selesai</Badge>
          <Badge tone="red">Tidak dibuka</Badge>
        </div>
      </div>

      <ScheduleForm form={form} week={week} options={options} onClose={() => setForm(null)} onSaved={() => (setForm(null), reload())} />
    </div>
  );
}
