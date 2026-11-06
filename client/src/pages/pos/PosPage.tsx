import { parseScaleBarcode } from '@shared/barcode';
import { can } from '@shared/permissions';
import { priceLine, summarize, type PromoRule } from '@shared/pricing';
import {
  AlertTriangle,
  ArrowLeftRight,
  CalendarClock,
  Camera,
  CheckCircle2,
  CircleHelp,
  Clock,
  CreditCard,
  FileText,
  History,
  LayoutDashboard,
  ListRestart,
  Lock,
  LogOut,
  Monitor,
  PauseCircle,
  Printer,
  ReceiptText,
  ScanBarcode,
  Search,
  ShoppingBasket,
  Tag,
  Trash2,
  UserRound,
  Vault,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CameraScanDialog } from '../../components/CameraScanner';
import { useFeedback } from '../../components/Feedback';
import { Receipt, ShiftReport, usePrint, type ReceiptSettings } from '../../components/Print';
import { NumberInput, ProductSearchDialog, searchCatalog, SupervisorDialog, type Approval, type ProductLite } from '../../components/shared';
import { cx, ErrorBox, Kbd, Loading, Spinner } from '../../components/ui';
import { ApiError, get, post } from '../../lib/api';
import { HANDOVER_KEY, useAuth } from '../../lib/auth';
import { fmtRange, fmtTime, isoDate, maskMember, money, parseNumber, qty as fmtQty, rp } from '../../lib/format';
import { beep, useClock } from '../../lib/hooks';
import PaymentDialog, { type PaymentLine } from './PaymentDialog';
import { CashDialog, CloseShiftDialog, HeldDialog, HelpDialog, HistoryDialog, HoldDialog, LockScreen, MemberDialog, MenuDialog, QtyDialog, ReceiptDialog, type Member } from './PosDialogs';

const TERMINAL_KEY = 'nusapos.terminal';

interface Settings extends ReceiptSettings {
  tax_rate: number;
  points_per_amount: number;
  max_drawer_cash: number;
  auto_print_receipt: boolean;
  void_requires_approval: boolean;
  opening_cash_default: number;
  enforce_schedule: boolean;
}

interface ScheduleSlot {
  id: number;
  user_id: number;
  start_at: string;
  end_at: string;
  full_name: string;
  username: string;
}

interface Bootstrap {
  terminal: { id: number; code: string; name: string; store_id: number; store_code: string; store_name: string };
  shift: any | null;
  settings: Settings;
  promos: PromoRule[];
  held_count: number;
  my_schedule: { id: number; start_at: string; end_at: string } | null;
  schedules: ScheduleSlot[];
  my_upcoming: { id: number; start_at: string; end_at: string; terminal_id: number; terminal_code: string }[];
}

interface CartLine {
  key: string;
  product: ProductLite;
  qty: number;
}

export default function PosPage() {
  const { user, logout } = useAuth();
  const { toast } = useFeedback();
  const [terminalId, setTerminalId] = useState<number | null>(() => Number(localStorage.getItem(TERMINAL_KEY)) || null);
  const [boot, setBoot] = useState<Bootstrap | null>(null);
  const [error, setError] = useState<string | null>(null);
  const autoOpening = useRef(false);

  const load = useCallback(async () => {
    if (!terminalId) return;
    setError(null);
    try {
      setBoot(await get<Bootstrap>('/pos/bootstrap', { terminal_id: terminalId }));
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403)) {
        localStorage.removeItem(TERMINAL_KEY);
        setTerminalId(null);
      } else setError((e as Error).message);
    }
  }, [terminalId]);

  useEffect(() => {
    setBoot(null);
    load();
  }, [load]);

  // Shift dibuka otomatis jika user terjadwal di terminal ini.
  useEffect(() => {
    if (!boot || boot.shift || !boot.my_schedule || autoOpening.current) return;
    autoOpening.current = true;
    post('/shifts/open', { terminal_id: boot.terminal.id })
      .then((shift) => {
        setBoot((b) => (b ? { ...b, shift } : b));
        toast(`Shift dibuka otomatis sesuai jadwal ${fmtRange(boot.my_schedule!.start_at, boot.my_schedule!.end_at)}`);
      })
      .catch((e) => setError((e as Error).message))
      .finally(() => (autoOpening.current = false));
  }, [boot, toast]);

  const chooseTerminal = (id: number | null) => {
    if (id) localStorage.setItem(TERMINAL_KEY, String(id));
    else localStorage.removeItem(TERMINAL_KEY);
    setTerminalId(id);
  };

  /** Setelah shift ditutup: simpan info kasir berikutnya lalu keluar otomatis. */
  const handover = async () => {
    try {
      const b = await get<Bootstrap>('/pos/bootstrap', { terminal_id: terminalId });
      const next = b.schedules.find((s) => s.user_id !== user!.id);
      if (next) localStorage.setItem(HANDOVER_KEY, JSON.stringify({ terminal_code: b.terminal.code, ...next }));
      else localStorage.removeItem(HANDOVER_KEY);
    } catch {
      localStorage.removeItem(HANDOVER_KEY);
    }
    logout();
  };

  if (!terminalId) return <TerminalPicker onPick={chooseTerminal} />;
  if (error)
    return (
      <Shell>
        <div className="mx-auto mt-20 max-w-md space-y-3">
          <ErrorBox message={error} onRetry={load} />
          <button className="btn btn-ghost w-full" onClick={() => chooseTerminal(null)}>
            <ArrowLeftRight className="size-4" /> Pilih Terminal Lain
          </button>
        </div>
      </Shell>
    );
  if (!boot || (!boot.shift && boot.my_schedule))
    return (
      <Shell>
        <Loading label={boot ? 'Membuka shift sesuai jadwal…' : 'Menyiapkan terminal…'} />
      </Shell>
    );
  if (!boot.shift) {
    if (user!.role === 'CASHIER' && boot.settings.enforce_schedule) return <NoSchedule boot={boot} onPick={chooseTerminal} />;
    return <OpenShift boot={boot} onOpened={(shift) => setBoot({ ...boot, shift })} onChangeTerminal={() => chooseTerminal(null)} />;
  }
  if (boot.shift.shift.user_id !== user!.id) return <TerminalBusy boot={boot} onClosed={load} onChangeTerminal={() => chooseTerminal(null)} />;
  return <PosTerminal boot={boot} setShift={(shift) => setBoot({ ...boot, shift })} onHandover={handover} />;
}

/** Bingkai layar sebelum shift berjalan. Logout hanya tersedia di sini (belum ada shift aktif). */
function Shell({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  return (
    <div className="min-h-screen bg-slate-100">
      <header className="flex h-14 items-center gap-3 bg-slate-950 px-5 text-white">
        <div className="grid size-8 place-items-center rounded-lg bg-brand-600 font-black">N</div>
        <span className="font-semibold">NusaPOS Kasir</span>
        <span className="ml-auto text-sm text-slate-400">{user?.full_name}</span>
        {can(user?.role, 'dashboard.view') && (
          <button className="btn btn-sm btn-ghost text-slate-300 hover:bg-white/10 hover:text-white" onClick={() => navigate('/')}>
            <LayoutDashboard className="size-4" /> Backoffice
          </button>
        )}
        <button className="btn btn-sm btn-ghost text-slate-300 hover:bg-white/10 hover:text-white" onClick={logout}>
          <LogOut className="size-4" /> Keluar
        </button>
      </header>
      {children}
    </div>
  );
}

function ScheduleQueue({ slots, title = 'Jadwal terminal ini' }: { slots: ScheduleSlot[]; title?: string }) {
  if (!slots.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 p-3 text-left">
      <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">{title}</p>
      <ul className="space-y-1 text-sm">
        {slots.map((s) => (
          <li key={s.id} className="flex justify-between gap-3">
            <span className="text-slate-700">{s.full_name}</span>
            <span className="font-mono text-slate-500">{fmtRange(s.start_at, s.end_at, true)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TerminalPicker({ onPick }: { onPick: (id: number) => void }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    get<any[]>('/pos/terminals')
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  const stores = rows ? [...new Set(rows.map((r) => r.store_code))] : [];
  return (
    <Shell>
      <div className="mx-auto max-w-4xl p-6">
        <h1 className="text-xl font-bold">Pilih Terminal Kasir</h1>
        <p className="text-sm text-slate-500">Pilihan disimpan di perangkat ini. Lakukan sekali saat instalasi komputer kasir.</p>
        {error && <ErrorBox message={error} />}
        {!rows && !error && <Loading />}
        {stores.map((code) => (
          <div key={code} className="mt-6">
            <p className="mb-2 text-sm font-semibold text-slate-600">
              {code} — {rows!.find((r) => r.store_code === code).store_name}
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {rows!
                .filter((r) => r.store_code === code)
                .map((t) => {
                  const mine = t.open_shift_user_id === user!.id;
                  const busy = t.open_shift_id && !mine;
                  const [start, end] = t.my_schedule ? String(t.my_schedule).split('|') : [];
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPick(t.id)}
                      className={cx('card flex items-center gap-4 p-4 text-left transition hover:border-brand-400 hover:shadow-md', (mine || start) && 'border-emerald-400 ring-2 ring-emerald-400/20')}
                    >
                      <div className={cx('grid size-11 place-items-center rounded-xl', busy ? 'bg-amber-100 text-amber-700' : 'bg-brand-100 text-brand-700')}>
                        <Monitor className="size-5" />
                      </div>
                      <div>
                        <p className="font-semibold">{t.code}</p>
                        <p className="text-xs text-slate-500">{mine ? 'Shift Anda sedang berjalan' : busy ? `Dipakai: ${t.open_shift_user}` : 'Tersedia'}</p>
                        {start && <p className="text-xs font-medium text-emerald-700">Jadwal Anda {fmtRange(start, end, true)}</p>}
                      </div>
                    </button>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </Shell>
  );
}

function NoSchedule({ boot, onPick }: { boot: Bootstrap; onPick: (id: number | null) => void }) {
  const now = new Date();
  const elsewhere = boot.my_upcoming.find((s) => s.terminal_id !== boot.terminal.id && new Date(s.start_at.replace(' ', 'T')).getTime() - now.getTime() <= 30 * 60_000);
  return (
    <Shell>
      <div className="mx-auto mt-16 max-w-md space-y-4 rounded-2xl bg-white p-8 text-center shadow">
        <CalendarClock className="mx-auto size-10 text-amber-500" />
        <div>
          <h2 className="text-lg font-semibold">Belum ada jadwal di {boot.terminal.code}</h2>
          <p className="mt-1 text-sm text-slate-500">Shift hanya dapat dibuka sesuai jadwal dari kepala toko.</p>
        </div>
        {elsewhere && (
          <button className="btn btn-primary w-full" onClick={() => onPick(elsewhere.terminal_id)}>
            Pindah ke {elsewhere.terminal_code} ({fmtRange(elsewhere.start_at, elsewhere.end_at)})
          </button>
        )}
        {boot.my_upcoming.length > 0 ? (
          <div className="rounded-lg border border-slate-200 p-3 text-left">
            <p className="mb-1.5 text-xs font-semibold tracking-wide text-slate-500 uppercase">Jadwal Anda</p>
            <ul className="space-y-1 text-sm">
              {boot.my_upcoming.map((s) => (
                <li key={s.id} className="flex justify-between gap-3">
                  <span className="text-slate-700">{s.terminal_code}</span>
                  <span className="font-mono text-slate-500">{fmtRange(s.start_at, s.end_at, true)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-slate-500">Anda belum memiliki jadwal mendatang.</p>
        )}
        <ScheduleQueue slots={boot.schedules} />
        <button className="btn btn-ghost w-full" onClick={() => onPick(null)}>
          <ArrowLeftRight className="size-4" /> Pilih Terminal Lain
        </button>
      </div>
    </Shell>
  );
}

function TerminalBusy({ boot, onClosed, onChangeTerminal }: { boot: Bootstrap; onClosed: () => void; onChangeTerminal: () => void }) {
  const { user } = useAuth();
  const [closing, setClosing] = useState(false);
  const owner = boot.shift.shift;
  return (
    <Shell>
      <div className="mx-auto mt-16 max-w-md space-y-4 rounded-2xl bg-white p-8 text-center shadow">
        <AlertTriangle className="mx-auto size-10 text-amber-500" />
        <div>
          <h2 className="text-lg font-semibold">{boot.terminal.code} masih dipakai</h2>
          <p className="mt-1 text-sm text-slate-500">
            Shift atas nama <b>{owner.cashier_name}</b>
            {owner.schedule_end && ` (jadwal s.d. ${fmtTime(owner.schedule_end)})`} belum ditutup.
          </p>
          {boot.my_schedule && <p className="mt-2 text-sm text-slate-600">Jadwal Anda {fmtRange(boot.my_schedule.start_at, boot.my_schedule.end_at)} sudah tiba. Tutup shift sebelumnya untuk serah terima.</p>}
        </div>
        <button className="btn btn-primary w-full" onClick={() => setClosing(true)}>
          Hitung Kas & Tutup Shift {owner.cashier_name.split(' ')[0]}
        </button>
        <ScheduleQueue slots={boot.schedules} />
        <button className="btn btn-ghost w-full" onClick={onChangeTerminal}>
          <ArrowLeftRight className="size-4" /> Pilih Terminal Lain
        </button>
      </div>
      <CloseShiftDialog
        open={closing}
        shiftId={owner.id}
        settings={boot.settings}
        ownerName={owner.cashier_name}
        requireApproval={!can(user?.role, 'pos.approve')}
        onClose={() => setClosing(false)}
        onClosed={() => {
          setClosing(false);
          onClosed();
        }}
      />
    </Shell>
  );
}

function OpenShift({ boot, onOpened, onChangeTerminal }: { boot: Bootstrap; onOpened: (s: any) => void; onChangeTerminal: () => void }) {
  const { user } = useAuth();
  const [cash, setCash] = useState(boot.settings.opening_cash_default);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const now = useClock();
  const open = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onOpened(await post('/shifts/open', { terminal_id: boot.terminal.id, opening_cash: cash }));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <div className="mx-auto mt-12 max-w-md p-4">
        <form onSubmit={open} className="card overflow-hidden">
          <div className="bg-gradient-to-br from-brand-600 to-brand-800 p-6 text-white">
            <p className="text-sm text-brand-100">
              {boot.terminal.store_code} · {boot.terminal.store_name}
            </p>
            <h1 className="mt-1 text-2xl font-bold">Buka Shift {boot.terminal.code}</h1>
            <p className="mt-3 font-mono text-3xl tabular-nums">{now.toLocaleTimeString('id-ID')}</p>
            <p className="text-sm text-brand-100">{now.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
          <div className="space-y-4 p-6">
            <p className="text-sm text-slate-600">
              Petugas: <b>{user?.full_name}</b> ({user?.employee_no}) · tanpa jadwal (shift cadangan)
            </p>
            <label className="block">
              <span className="label">Modal awal di laci</span>
              <NumberInput value={cash} onChange={setCash} className="py-3 font-mono text-2xl font-bold" autoFocus />
            </label>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <button className="btn btn-primary btn-lg w-full" disabled={busy}>
              {busy && <Spinner />} Buka Shift
            </button>
            <ScheduleQueue slots={boot.schedules} />
            <button type="button" className="btn btn-ghost w-full" onClick={onChangeTerminal}>
              <ArrowLeftRight className="size-4" /> Ganti Terminal
            </button>
          </div>
        </form>
      </div>
    </Shell>
  );
}

type DialogName = 'search' | 'qty' | 'member' | 'pay' | 'hold' | 'held' | 'menu' | 'help' | 'cash' | 'history' | 'close' | 'receipt' | 'camera';

const SHIFT_WARNING_MS = 15 * 60_000;

function PosTerminal({ boot, setShift, onHandover }: { boot: Bootstrap; setShift: (s: any) => void; onHandover: () => void }) {
  const { user } = useAuth();
  const { toast, confirm } = useFeedback();
  const print = usePrint();
  const navigate = useNavigate();
  const now = useClock();
  const { terminal, settings, promos } = boot;
  const summary = boot.shift;
  const shift = summary.shift;

  const [lines, setLines] = useState<CartLine[]>([]);
  const [selected, setSelected] = useState(0);
  const [member, setMember] = useState<Member | null>(null);
  const [input, setInput] = useState('');
  const [multiplier, setMultiplier] = useState<number | null>(null);
  const [message, setMessage] = useState<{ kind: 'error' | 'info'; text: string } | null>(null);
  const [lastAdded, setLastAdded] = useState<{ line: CartLine; at: number } | null>(null);
  const [dialog, setDialog] = useState<DialogName | null>(null);
  const [approval, setApproval] = useState<{ description: string; action: string; run: () => void } | null>(null);
  const [lastSale, setLastSale] = useState<any>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [looking, setLooking] = useState(false);
  const [locked, setLocked] = useState(false);
  const [catalog, setCatalog] = useState<ProductLite[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestIdx, setSuggestIdx] = useState(-1);
  const [pendingWeighted, setPendingWeighted] = useState<ProductLite | null>(null);
  const [clientRef, setClientRef] = useState(() => crypto.randomUUID());
  const inputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  // Ref agar scan beruntun selalu memakai isi keranjang terbaru.
  const linesRef = useRef(lines);
  linesRef.current = lines;

  // ---------------------------------------------------------------- Katalog lokal: scan & cari tanpa menunggu server
  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await get<ProductLite[]>('/pos/catalog', { terminal_id: terminal.id }));
    } catch {
      /* tetap memakai katalog terakhir; lookup ke server sebagai cadangan */
    }
  }, [terminal.id]);

  useEffect(() => {
    loadCatalog();
    const t = setInterval(loadCatalog, 5 * 60_000);
    return () => clearInterval(t);
  }, [loadCatalog]);

  const codeIndex = useMemo(() => {
    const byCode = new Map<string, ProductLite>();
    const byPlu = new Map<string, ProductLite>();
    for (const p of catalog) {
      byCode.set(p.sku.toUpperCase(), p);
      if (p.barcode) byCode.set(p.barcode, p);
      if (p.plu_code) (byCode.set(p.plu_code, p), byPlu.set(p.plu_code, p));
    }
    return { byCode, byPlu };
  }, [catalog]);

  const findLocal = (code: string): { product: ProductLite; qty: number | null } | null => {
    const scale = parseScaleBarcode(code);
    if (scale) {
      const p = codeIndex.byPlu.get(scale.plu);
      return p?.is_weighted ? { product: p, qty: scale.weightKg } : null;
    }
    const p = codeIndex.byCode.get(code.toUpperCase());
    return p ? { product: p, qty: null } : null;
  };

  const parsedInput = useMemo(() => {
    const m = input.match(/^(\d+(?:[.,]\d+)?)\s*[*xX]\s*(.*)$/);
    return m ? { mult: parseNumber(m[1]), text: m[2].trim() } : { mult: null, text: input.trim() };
  }, [input]);

  // Saran saat mengetik nama/kode. Deretan angka panjang dianggap scan barcode, jadi tidak ditampilkan.
  const suggestions = useMemo(() => {
    const t = parsedInput.text;
    if (t.length < 2 || (/^\d+$/.test(t) && t.length >= 8)) return [];
    return searchCatalog(catalog, t, 8);
  }, [parsedInput.text, catalog]);

  useEffect(() => setSuggestIdx(-1), [parsedInput.text]);

  // ---------------------------------------------------------------- Harga & total
  const priced = useMemo(() => {
    const ctx = { isMember: !!member, storeId: terminal.store_id, date: isoDate() };
    return lines.map((l) => ({
      ...l,
      isWeighted: !!l.product.is_weighted,
      taxType: l.product.tax_type,
      price: priceLine(
        { productId: l.product.id, categoryId: l.product.category_id, unitPrice: l.product.sell_price, qty: l.qty, taxType: l.product.tax_type, isWeighted: !!l.product.is_weighted },
        promos,
        ctx,
      ),
    }));
  }, [lines, member, promos, terminal.store_id]);
  const totals = useMemo(() => summarize(priced, settings.tax_rate), [priced, settings.tax_rate]);
  const current = priced[selected];
  const drawerFull = summary.cash.expected > settings.max_drawer_cash;

  // ---------------------------------------------------------------- Jadwal: peringatan & penutupan otomatis
  const scheduleEndMs = shift.schedule_end ? new Date(String(shift.schedule_end).replace(' ', 'T')).getTime() : null;
  const msLeft = scheduleEndMs === null ? null : scheduleEndMs - now.getTime();
  const shiftOver = msLeft !== null && msLeft <= 0;
  const endingSoon = msLeft !== null && msLeft > 0 && msLeft <= SHIFT_WARNING_MS;
  const anyOpen = !!dialog || !!approval || locked;

  useEffect(() => {
    if (shiftOver && !lines.length && !anyOpen) setDialog('close');
  }, [shiftOver, lines.length, anyOpen]);

  const refreshShift = useCallback(async () => {
    try {
      setShift(await get(`/shifts/${shift.id}`));
    } catch {
      /* diabaikan; diperbarui pada siklus berikutnya */
    }
  }, [shift.id, setShift]);

  // Perubahan jadwal oleh kepala toko & saldo laci ikut diperbarui berkala.
  useEffect(() => {
    const t = setInterval(refreshShift, 60_000);
    return () => clearInterval(t);
  }, [refreshShift]);

  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => (window.removeEventListener('online', on), window.removeEventListener('offline', off));
  }, []);

  // Cegah reload/tutup tab tak sengaja saat ada transaksi berjalan.
  useEffect(() => {
    if (!lines.length) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [lines.length]);

  // Tombol fungsi tidak boleh memicu aksi browser (reload, cari, menu), termasuk saat dialog terbuka.
  useEffect(() => {
    const block = (e: KeyboardEvent) => {
      if (/^F([1-9]|10|12)$/.test(e.key)) e.preventDefault();
    };
    window.addEventListener('keydown', block, true);
    return () => window.removeEventListener('keydown', block, true);
  }, []);

  useEffect(() => {
    if (!anyOpen) requestAnimationFrame(() => inputRef.current?.focus());
  }, [anyOpen]);

  useEffect(() => {
    tableRef.current?.querySelector(`[data-row="${selected}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [selected, lines.length]);

  const fail = (text: string) => {
    beep('error');
    setMessage({ kind: 'error', text });
  };

  // ---------------------------------------------------------------- Keranjang
  const addProduct = (product: ProductLite, qty: number) => {
    if (shiftOver && !linesRef.current.length) return fail('Jam shift Anda telah berakhir. Tutup shift untuk serah terima.');
    if (!product.is_weighted && !Number.isInteger(qty)) return fail(`${product.name} dijual per ${product.unit}, jumlah harus bulat`);
    const prev = linesRef.current;
    const idx = product.is_weighted ? -1 : prev.findIndex((l) => l.product.id === product.id);
    const line: CartLine = idx >= 0 ? { ...prev[idx], qty: prev[idx].qty + qty } : { key: `${product.id}-${Date.now()}`, product, qty };
    const next = idx >= 0 ? prev.map((l, i) => (i === idx ? line : l)) : [...prev, line];
    linesRef.current = next;
    setLines(next);
    setSelected(idx >= 0 ? idx : next.length - 1);
    setLastAdded({ line, at: Date.now() });
    beep('ok');
    setMessage(product.stock - line.qty < 0 ? { kind: 'info', text: `Perhatian: stok sistem ${product.name} tidak mencukupi (${fmtQty(product.stock, product.is_weighted)}).` } : null);
  };

  const addHit = (hit: { product: ProductLite; qty: number | null }, mult: number | null) => {
    setMultiplier(null);
    if (hit.product.is_weighted && hit.qty === null && !mult) {
      setPendingWeighted(hit.product);
      setDialog('qty');
      return;
    }
    addProduct(hit.product, hit.qty ?? mult ?? 1);
  };

  // Cadangan: produk yang baru ditambahkan setelah katalog dimuat.
  const lookupRemote = async (code: string) => {
    const r = await get<{ product: ProductLite; qty: number | null }>('/products/lookup', { code, store_id: terminal.store_id });
    setCatalog((c) => (c.some((p) => p.id === r.product.id) ? c : [...c, r.product]));
    return r;
  };

  /** Kode dari kamera: dicocokkan seperti hasil scanner, tanpa saran ketikan. */
  const scanCode = async (code: string) => {
    if (shiftOver && !linesRef.current.length) throw new Error('Jam shift Anda telah berakhir. Tutup shift untuk serah terima.');
    const hit = findLocal(code) ?? (await lookupRemote(code));
    addHit(hit, multiplier);
    return `${hit.product.name} · ${rp(hit.product.sell_price)}`;
  };

  /** Enter di kolom scan: kode persis → saran terpilih → satu-satunya saran → daftar pencarian → server. */
  const scan = async (picked?: ProductLite) => {
    const { mult: typedMult, text } = parsedInput;
    const mult = typedMult ?? multiplier;
    if (!picked && !text) {
      if (typedMult !== null) (setMultiplier(typedMult), setInput(''));
      return;
    }
    const chosen = picked ?? (suggestIdx >= 0 ? suggestions[suggestIdx] : undefined);
    setInput('');
    if (chosen) return addHit({ product: chosen, qty: null }, mult);
    const local = findLocal(text);
    if (local) return addHit(local, mult);
    if (suggestions.length === 1) return addHit({ product: suggestions[0], qty: null }, mult);
    if (suggestions.length > 1) {
      setMultiplier(mult);
      setSearchQuery(text);
      setDialog('search');
      return;
    }
    setLooking(true);
    try {
      addHit(await lookupRemote(text), mult);
    } catch (e) {
      setMultiplier(null);
      fail((e as Error).message);
    } finally {
      setLooking(false);
    }
  };

  const withApproval = (description: string, action: string, run: () => void) => {
    if (!settings.void_requires_approval) return run();
    setApproval({ description, action, run });
  };

  const removeLine = (idx: number) => {
    const l = lines[idx];
    if (!l) return;
    withApproval(`Hapus ${l.product.name} (${fmtQty(l.qty, l.product.is_weighted)})`, 'VOID_LINE', () => {
      setLines((prev) => prev.filter((_, i) => i !== idx));
      setSelected((s) => Math.max(0, Math.min(s, lines.length - 2)));
      toast(`${l.product.name} dihapus dari transaksi`, 'info');
    });
  };

  const changeQty = (qty: number) => {
    if (pendingWeighted) {
      const p = pendingWeighted;
      setPendingWeighted(null);
      setDialog(null);
      if (qty > 0) addProduct(p, qty);
      return;
    }
    const l = lines[selected];
    setDialog(null);
    if (!l || qty === l.qty) return;
    if (qty === 0) return removeLine(selected);
    const apply = () => setLines((prev) => prev.map((x, i) => (i === selected ? { ...x, qty } : x)));
    if (qty < l.qty) withApproval(`Kurangi ${l.product.name} dari ${l.qty} menjadi ${qty}`, 'REDUCE_QTY', apply);
    else apply();
  };

  const incrementSelected = () => {
    const l = lines[selected];
    if (!l) return;
    if (l.product.is_weighted) return fail('Barang timbang: ubah berat dengan F3');
    addProduct(l.product, 1);
  };

  const resetCart = () => {
    setLines([]);
    setMember(null);
    setSelected(0);
    setLastAdded(null);
    setMessage(null);
    setClientRef(crypto.randomUUID());
  };

  const cancelTransaction = async () => {
    if (!lines.length) return;
    if (!(await confirm({ title: 'Batalkan transaksi?', message: `${lines.length} baris barang akan dihapus.`, danger: true, confirmLabel: 'Batalkan Transaksi' }))) return;
    withApproval(`Batalkan transaksi berjalan (${rp(totals.total)})`, 'CANCEL_CART', () => {
      resetCart();
      toast('Transaksi dibatalkan', 'info');
    });
  };

  const hold = async (label: string) => {
    try {
      await post('/pos/held', { terminal_id: terminal.id, label: label || undefined, data: { lines: lines.map(({ product, qty }) => ({ product, qty })), member } });
      resetCart();
      setDialog(null);
      toast('Transaksi ditunda');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const recall = (data: any) => {
    setLines((data.lines ?? []).map((l: any, i: number) => ({ key: `${l.product.id}-${Date.now()}-${i}`, product: l.product, qty: l.qty })));
    setMember(data.member ?? null);
    setSelected(0);
    setDialog(null);
    toast('Transaksi dipanggil kembali');
  };

  /** Ambil harga & status produk terbaru sebelum bayar agar total di layar sama dengan perhitungan server. */
  const openPayment = async () => {
    if (!linesRef.current.length) return fail('Belum ada barang di transaksi');
    try {
      const ids = [...new Set(linesRef.current.map((l) => l.product.id))];
      const fresh = await get<ProductLite[]>('/pos/catalog', { terminal_id: terminal.id, ids: ids.join(',') });
      const map = new Map(fresh.map((p) => [p.id, p]));
      const inactive = linesRef.current.find((l) => !map.has(l.product.id));
      if (inactive) return fail(`${inactive.product.name} sudah tidak dijual lagi. Hapus dari transaksi.`);
      const changed = new Set<string>();
      const next = linesRef.current.map((l) => {
        const f = map.get(l.product.id)!;
        if (f.sell_price !== l.product.sell_price) changed.add(f.name);
        return { ...l, product: { ...l.product, ...f } };
      });
      linesRef.current = next;
      setLines(next);
      if (changed.size) toast(`Harga terbaru dipakai: ${[...changed].join(', ')}`, 'info');
    } catch {
      /* jaringan lambat: lanjut, server tetap memvalidasi harga saat checkout */
    }
    setMessage(null);
    setDialog('pay');
  };

  const checkout = async (payments: PaymentLine[]) => {
    const sold = lines.map((l) => ({ product_id: l.product.id, qty: l.qty }));
    const sale = await post('/sales/checkout', { client_ref: clientRef, shift_id: shift.id, member_id: member?.id ?? null, items: sold, payments });
    setLastSale(sale);
    resetCart();
    setCatalog((c) => c.map((p) => ({ ...p, stock: p.stock - sold.filter((s) => s.product_id === p.id).reduce((a, s) => a + s.qty, 0) })));
    setDialog('receipt');
    if (settings.auto_print_receipt) print(<Receipt sale={sale} settings={settings} />);
    refreshShift();
  };

  const openDialog = (name: DialogName) => {
    if (name === 'pay') return openPayment();
    if (name === 'hold' && !lines.length) return fail('Belum ada barang di transaksi');
    if (name === 'qty' && !lines.length) return fail('Pilih barang terlebih dahulu');
    if (name === 'held' && lines.length) return fail('Selesaikan atau tunda transaksi aktif terlebih dahulu');
    if (name === 'held' && shiftOver) return fail('Jam shift Anda telah berakhir. Tutup shift untuk serah terima.');
    if (name === 'search') setSearchQuery(parsedInput.text);
    setMessage(null);
    setDialog(name);
  };

  // Pintasan keyboard global layar kasir
  useEffect(() => {
    if (anyOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = {
        F1: () => openDialog('help'),
        F2: () => openDialog('search'),
        F3: () => openDialog('qty'),
        F4: () => openDialog('member'),
        F5: () => openDialog('history'),
        F6: () => openDialog('hold'),
        F7: () => openDialog('held'),
        F8: () => removeLine(selected),
        F9: cancelTransaction,
        F10: () => openDialog('pay'),
        F12: () => openDialog('menu'),
      };
      if (map[e.key]) {
        e.preventDefault();
        map[e.key]();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(lines.length - 1, s + 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(0, s - 1));
      } else if (e.key === 'Delete' && !input) {
        e.preventDefault();
        removeLine(selected);
      } else if (e.key === '+' && !input) {
        e.preventDefault();
        incrementSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const menuActions = [
    { key: '1', label: 'Riwayat Transaksi', desc: 'Cetak ulang, void, atau retur (F5)', icon: History, onClick: () => setDialog('history') },
    { key: '2', label: 'Mutasi Kas & Pickup', desc: 'Setoran brankas, kas masuk/keluar', icon: Vault, onClick: () => setDialog('cash') },
    {
      key: '3',
      label: 'Cetak Ulang Struk Terakhir',
      desc: lastSale ? lastSale.receipt_no : 'Belum ada transaksi',
      icon: Printer,
      onClick: () => (lastSale ? (print(<Receipt sale={lastSale} settings={settings} copy />), setDialog(null)) : fail('Belum ada transaksi di sesi ini')),
    },
    {
      key: '4',
      label: 'Laporan Shift (X)',
      desc: 'Cetak ringkasan shift berjalan',
      icon: FileText,
      onClick: async () => {
        const s = await get(`/shifts/${shift.id}`);
        setShift(s);
        print(<ShiftReport summary={s} settings={settings} />);
        setDialog(null);
      },
    },
    { key: '5', label: 'Kunci Layar', desc: 'Saat istirahat; buka dengan password Anda', icon: Lock, onClick: () => (setDialog(null), setLocked(true)) },
    { key: '6', label: 'Backoffice', desc: 'Dashboard & manajemen', icon: LayoutDashboard, onClick: () => navigate('/'), hidden: !can(user?.role, 'dashboard.view') },
    {
      key: '9',
      label: 'Tutup Shift',
      desc: 'Hitung kas, cetak laporan Z, serah terima',
      icon: Clock,
      danger: true,
      onClick: () => (lines.length ? fail('Selesaikan transaksi aktif sebelum tutup shift') : setDialog('close')),
    },
  ];

  const recentAdded = lastAdded && Date.now() - lastAdded.at < 1500 ? lastAdded.line.key : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-200 select-none">
      {/* Header */}
      <header className="flex h-12 shrink-0 items-center gap-4 bg-slate-950 px-4 text-sm text-slate-300">
        <div className="flex items-center gap-2">
          <div className="grid size-7 place-items-center rounded-md bg-brand-600 text-xs font-black text-white">N</div>
          <span className="font-semibold text-white">{settings.company_brand}</span>
        </div>
        <span className="hidden md:inline">
          {terminal.store_code} · {terminal.store_name}
        </span>
        <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-xs text-white">{terminal.code}</span>
        <span className="hidden font-mono text-xs lg:inline">{shift.shift_no}</span>
        <span className="hidden items-center gap-1 text-xs xl:flex">
          <CalendarClock className="size-3.5" />
          {shift.schedule_start ? fmtRange(shift.schedule_start, shift.schedule_end) : 'Shift cadangan'}
        </span>
        <div className="ml-auto flex items-center gap-4">
          {drawerFull && (
            <button onClick={() => setDialog('cash')} className="flex items-center gap-1.5 rounded bg-amber-500/20 px-2 py-0.5 text-xs font-semibold text-amber-300">
              <AlertTriangle className="size-3.5" /> Laci melebihi batas — lakukan pickup
            </button>
          )}
          <span className="flex items-center gap-1.5">
            <UserRound className="size-4" />
            {user?.full_name}
          </span>
          <span className={cx('flex items-center gap-1 text-xs', online ? 'text-emerald-400' : 'text-rose-400')}>
            {online ? <Wifi className="size-4" /> : <WifiOff className="size-4" />}
            {online ? 'Online' : 'Offline'}
          </span>
          <span className="font-mono text-base text-white tabular-nums">{now.toLocaleTimeString('id-ID')}</span>
        </div>
      </header>

      {(endingSoon || shiftOver) && (
        <div className={cx('flex shrink-0 items-center justify-center gap-2 px-4 py-1.5 text-sm font-medium', shiftOver ? 'bg-rose-600 text-white' : 'bg-amber-400 text-amber-950')}>
          <Clock className="size-4" />
          {shiftOver
            ? 'Jam shift berakhir. Selesaikan transaksi ini; setelah itu shift ditutup untuk serah terima.'
            : `Shift berakhir pukul ${fmtTime(shift.schedule_end)} (${Math.ceil(msLeft! / 60_000)} menit lagi).`}
        </div>
      )}

      <div className="flex min-h-0 flex-1 gap-3 p-3">
        {/* Kiri: input & keranjang */}
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <form onSubmit={(e) => (e.preventDefault(), scan())} className="relative flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
            <ScanBarcode className="size-6 shrink-0 text-brand-600" />
            {multiplier && <span className="rounded-lg bg-amber-100 px-2.5 py-1.5 font-mono text-sm font-bold text-amber-800">{multiplier}×</span>}
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && input) {
                  e.stopPropagation();
                  setInput('');
                } else if (suggestions.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault();
                  e.stopPropagation();
                  setSuggestIdx((i) => (e.key === 'ArrowDown' ? Math.min(suggestions.length - 1, i + 1) : Math.max(-1, i - 1)));
                }
              }}
              onBlur={() => setTimeout(() => !document.querySelector('[role=dialog]') && !locked && inputRef.current?.focus(), 150)}
              className="min-w-0 flex-1 border-0 bg-transparent font-mono text-xl font-semibold text-slate-900 outline-none placeholder:font-sans placeholder:text-base placeholder:font-normal placeholder:text-slate-400"
              placeholder="Scan barcode, atau ketik kode / nama barang"
              autoComplete="off"
              spellCheck={false}
            />
            {looking && <Spinner className="size-5 text-slate-400" />}
            <button type="button" className="btn btn-secondary" onClick={() => openDialog('camera')} title="Scan barcode dengan webcam atau kamera HP">
              <Camera className="size-4" /> Kamera
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => openDialog('search')}>
              <Search className="size-4" /> Cari Barang <Kbd>F2</Kbd>
            </button>
            {suggestions.length > 0 && (
              <div className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {suggestions.map((p, i) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => scan(p)}
                    onMouseEnter={() => setSuggestIdx(i)}
                    className={cx('flex w-full items-center gap-4 px-4 py-2 text-left', i === suggestIdx ? 'bg-brand-50' : 'hover:bg-slate-50')}
                  >
                    <span className="w-28 shrink-0 font-mono text-xs text-slate-500">{p.barcode ?? p.plu_code ?? p.sku}</span>
                    <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{p.name}</span>
                    <span className={cx('text-xs', p.stock <= 0 ? 'text-rose-600' : 'text-slate-400')}>
                      stok {fmtQty(p.stock, p.is_weighted)} {p.unit}
                    </span>
                    <span className="w-20 text-right font-mono font-semibold">{money(p.sell_price)}</span>
                  </button>
                ))}
                <p className="border-t border-slate-100 bg-slate-50 px-4 py-1.5 text-xs text-slate-500">↑ ↓ pilih · Enter tambahkan · Esc hapus ketikan</p>
              </div>
            )}
          </form>

          {message && (
            <div className={cx('flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium', message.kind === 'error' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-900')}>
              {message.kind === 'error' ? <XCircle className="size-4" /> : <AlertTriangle className="size-4" />}
              {message.text}
              <button className="ml-auto opacity-70 hover:opacity-100" onClick={() => setMessage(null)}>
                ✕
              </button>
            </div>
          )}

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-sm">
            <div ref={tableRef} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 z-[1] bg-slate-800 text-[11px] tracking-wider text-slate-300 uppercase">
                  <tr>
                    <th className="w-10 px-3 py-2.5 text-left">#</th>
                    <th className="px-3 py-2.5 text-left">Nama Barang</th>
                    <th className="w-28 px-3 py-2.5 text-right">Qty</th>
                    <th className="w-28 px-3 py-2.5 text-right">Harga</th>
                    <th className="w-28 px-3 py-2.5 text-right">Diskon</th>
                    <th className="w-32 px-3 py-2.5 text-right">Total</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {priced.map((l, i) => (
                    <tr
                      key={l.key}
                      data-row={i}
                      onClick={() => setSelected(i)}
                      onDoubleClick={() => (setSelected(i), openDialog('qty'))}
                      className={cx('cursor-pointer border-b border-slate-100', i === selected ? 'bg-brand-50 outline-2 -outline-offset-2 outline-brand-500' : 'hover:bg-slate-50', recentAdded === l.key && 'flash-row')}
                    >
                      <td className="px-3 py-2 text-slate-400 tabular-nums">{i + 1}</td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-slate-900">
                          {l.product.name}
                          {l.product.tax_type === 'NON_PPN' && <span className="ml-1.5 text-[10px] font-normal text-slate-400">NON-PPN</span>}
                        </div>
                        <div className="font-mono text-[11px] text-slate-500">
                          {l.product.barcode ?? l.product.plu_code ?? l.product.sku}
                          {l.price.promoName && (
                            <span className="ml-2 inline-flex items-center gap-1 rounded bg-emerald-100 px-1.5 font-sans font-semibold text-emerald-700">
                              <Tag className="size-3" /> {l.price.promoName}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-base font-semibold">
                        {fmtQty(l.qty, l.product.is_weighted)}
                        <span className="ml-1 text-[10px] font-normal text-slate-400">{l.product.unit}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono">{money(l.product.sell_price)}</td>
                      <td className="px-3 py-2 text-right font-mono text-emerald-600">{l.price.discount ? `-${money(l.price.discount)}` : ''}</td>
                      <td className="px-3 py-2 text-right font-mono text-base font-bold">{money(l.price.net)}</td>
                      <td className="pr-2">
                        <button className="rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-600" onClick={(e) => (e.stopPropagation(), removeLine(i))} aria-label="Hapus baris" tabIndex={-1}>
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!lines.length && (
                <div className="flex h-[70%] flex-col items-center justify-center text-slate-400">
                  <ShoppingBasket className="size-16 stroke-1" />
                  <p className="mt-3 text-lg font-medium text-slate-500">Keranjang kosong</p>
                  <p className="text-sm">Scan barcode, atau ketik kode / nama barang untuk memulai</p>
                  {lastSale && (
                    <p className="mt-6 text-xs">
                      Transaksi terakhir: <span className="font-mono">{lastSale.receipt_no}</span> · {rp(lastSale.total)} · {fmtTime(lastSale.created_at)}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="flex items-center gap-6 border-t border-slate-200 bg-slate-50 px-4 py-2 text-xs text-slate-600 tabular-nums">
              <span>
                Baris: <b>{lines.length}</b>
              </span>
              <span>
                Item: <b>{fmtQty(totals.itemCount)}</b>
              </span>
              <span>
                DPP: <b>{money(totals.dpp)}</b>
              </span>
              <span>
                PPN {settings.tax_rate}%: <b>{money(totals.tax)}</b>
              </span>
              {totals.nonTaxableTotal > 0 && (
                <span>
                  Non-PPN: <b>{money(totals.nonTaxableTotal)}</b>
                </span>
              )}
              <button className="ml-auto hover:text-brand-700" onClick={() => setDialog('history')}>
                Shift: {summary.sales.trx_count} trx · {rp(summary.sales.sales_total)} · Riwayat <Kbd>F5</Kbd>
              </button>
            </div>
          </div>
        </section>

        {/* Kanan: total & fungsi */}
        <aside className="flex w-[360px] shrink-0 flex-col gap-3">
          <div className="rounded-xl bg-slate-950 p-5 text-white shadow-lg">
            <p className="text-xs font-semibold tracking-widest text-slate-400 uppercase">Total Belanja</p>
            <p className="mt-1 text-right font-mono text-5xl font-extrabold tracking-tight text-emerald-400 tabular-nums">{money(totals.total)}</p>
            <div className="mt-3 space-y-1 border-t border-white/10 pt-3 font-mono text-sm">
              <div className="flex justify-between text-slate-400">
                <span>Subtotal</span>
                <span>{money(totals.subtotal)}</span>
              </div>
              <div className="flex justify-between text-emerald-300">
                <span>Hemat (promo)</span>
                <span>-{money(totals.discountTotal)}</span>
              </div>
            </div>
          </div>

          {current ? (
            <div className="rounded-xl bg-white p-4 shadow-sm">
              <p className="text-[11px] font-semibold tracking-wide text-slate-400 uppercase">Barang terpilih</p>
              <p className="mt-0.5 truncate font-semibold text-slate-900">{current.product.name}</p>
              <div className="mt-1 flex justify-between text-sm text-slate-600">
                <span>
                  {fmtQty(current.qty, current.product.is_weighted)} {current.product.unit} × {money(current.product.sell_price)}
                </span>
                <span>Stok: {fmtQty(current.product.stock, current.product.is_weighted)}</span>
              </div>
            </div>
          ) : null}

          <button onClick={() => openDialog('member')} className={cx('flex items-center gap-3 rounded-xl p-4 text-left shadow-sm transition', member ? 'bg-gradient-to-r from-brand-700 to-brand-900 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
            <CreditCard className="size-6 shrink-0" />
            <div className="min-w-0 flex-1">
              {member ? (
                <>
                  <p className="truncate font-semibold">{member.name}</p>
                  <p className="font-mono text-xs opacity-80">
                    {maskMember(member.member_no)} · {money(member.points)} poin · {member.tier}
                  </p>
                </>
              ) : (
                <>
                  <p className="font-semibold">Belum ada member</p>
                  <p className="text-xs">Scan kartu untuk harga member & poin</p>
                </>
              )}
            </div>
            <Kbd>F4</Kbd>
          </button>

          <div className="grid flex-1 grid-cols-2 content-start gap-2">
            {[
              { k: 'F3', label: 'Ubah Qty', icon: ListRestart, run: () => openDialog('qty') },
              { k: 'F8', label: 'Hapus Item', icon: Trash2, run: () => removeLine(selected) },
              { k: 'F6', label: 'Tunda', icon: PauseCircle, run: () => openDialog('hold') },
              { k: 'F7', label: 'Panggil', icon: ReceiptText, run: () => openDialog('held') },
              { k: 'F5', label: 'Riwayat', icon: History, run: () => openDialog('history') },
              { k: 'F9', label: 'Batal Transaksi', icon: XCircle, run: cancelTransaction },
              { k: 'F12', label: 'Menu', icon: LayoutDashboard, run: () => openDialog('menu') },
              { k: 'F1', label: 'Bantuan', icon: CircleHelp, run: () => openDialog('help') },
            ].map((b) => (
              <button key={b.k} onClick={b.run} className="flex items-center gap-2 rounded-xl bg-white px-3 py-3 text-left text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.98]">
                <b.icon className="size-4 text-slate-500" />
                <span className="flex-1">{b.label}</span>
                <Kbd className="text-slate-500">{b.k}</Kbd>
              </button>
            ))}
          </div>

          <button
            onClick={() => openDialog('pay')}
            disabled={!lines.length}
            className="flex items-center justify-center gap-3 rounded-xl bg-emerald-600 px-4 py-5 text-xl font-bold text-white shadow-lg shadow-emerald-900/20 transition hover:bg-emerald-500 disabled:bg-slate-400 disabled:shadow-none"
          >
            <CheckCircle2 className="size-6" /> BAYAR <Kbd className="text-white">F10</Kbd>
          </button>
        </aside>
      </div>

      {/* Dialog */}
      <ProductSearchDialog
        open={dialog === 'search'}
        onClose={() => (setDialog(null), setMultiplier(null))}
        storeId={terminal.store_id}
        catalog={catalog}
        initialQuery={searchQuery}
        onSelect={(p) => {
          const mult = multiplier;
          if (p.is_weighted && !mult) {
            setMultiplier(null);
            setPendingWeighted(p);
            setTimeout(() => setDialog('qty'));
          } else addHit({ product: p, qty: null }, mult);
        }}
      />
      <CameraScanDialog open={dialog === 'camera'} continuous onClose={() => setDialog(null)} onDetected={scanCode} />
      <QtyDialog
        open={dialog === 'qty'}
        title={pendingWeighted ? `Berat ${pendingWeighted.name}` : `Ubah Jumlah — ${current?.product.name ?? ''}`}
        initial={pendingWeighted ? 0 : (current?.qty ?? 1)}
        weighted={pendingWeighted ? true : !!current?.product.is_weighted}
        onClose={() => (setDialog(null), setPendingWeighted(null))}
        onSubmit={changeQty}
      />
      <MemberDialog
        open={dialog === 'member'}
        current={member}
        canCreate={can(user?.role, 'members.manage')}
        onClose={() => setDialog(null)}
        onSelect={(m) => {
          setMember(m);
          setDialog(null);
          if (m) toast(`Member ${m.name} digunakan`);
        }}
      />
      <HoldDialog open={dialog === 'hold'} onClose={() => setDialog(null)} onSubmit={hold} />
      <HeldDialog open={dialog === 'held'} terminalId={terminal.id} onClose={() => setDialog(null)} onRecall={recall} />
      <PaymentDialog open={dialog === 'pay'} total={totals.total} member={member} pointValue={settings.point_value} onClose={() => setDialog(null)} onConfirm={checkout} />
      <ReceiptDialog open={dialog === 'receipt'} sale={lastSale} settings={settings} onClose={() => setDialog(null)} />
      <MenuDialog open={dialog === 'menu'} onClose={() => setDialog(null)} actions={menuActions} />
      <HelpDialog open={dialog === 'help'} onClose={() => setDialog(null)} />
      <CashDialog
        open={dialog === 'cash'}
        shiftId={shift.id}
        onClose={() => setDialog(null)}
        onDone={(s) => {
          setShift(s);
          setDialog(null);
          toast('Mutasi kas tercatat');
        }}
      />
      <HistoryDialog
        open={dialog === 'history'}
        shiftId={shift.id}
        terminalId={terminal.id}
        settings={settings}
        onClose={() => setDialog(null)}
        onChanged={(msg) => {
          toast(msg);
          refreshShift();
          loadCatalog();
        }}
      />
      <CloseShiftDialog open={dialog === 'close'} forced={shiftOver} shiftId={shift.id} settings={settings} onClose={() => setDialog(null)} onClosed={onHandover} />
      <SupervisorDialog
        open={!!approval}
        description={approval?.description}
        onClose={() => setApproval(null)}
        onSubmit={async (a: Approval) => {
          await post('/auth/verify-supervisor', { ...a, store_id: terminal.store_id, action: approval!.action, note: approval!.description });
          approval!.run();
        }}
      />
      <LockScreen open={locked} name={user!.full_name} terminalCode={terminal.code} onUnlock={() => setLocked(false)} />
    </div>
  );
}
