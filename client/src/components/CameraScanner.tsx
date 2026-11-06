import { Camera, CheckCircle2, Flashlight, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { beep } from '../lib/hooks';
import { cx, Modal, Spinner } from './ui';

/**
 * Scan barcode lewat kamera (webcam / kamera HP) untuk perangkat tanpa alat scanner.
 * Memakai BarcodeDetector bawaan browser bila tersedia (Android, macOS, ChromeOS);
 * selain itu dekoder ZXing dimuat saat pertama kali kamera dibuka.
 */

type Detect = (video: HTMLVideoElement) => Promise<string | null>;

const CAMERA_KEY = 'nusapos.camera';
const SCAN_INTERVAL_MS = 120;
/** Barang yang sama baru dihitung lagi setelah keluar dari bingkai selama ini. */
const SAME_CODE_GAP_MS = 1200;
const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code'];

let detectorPromise: Promise<Detect> | null = null;

function createDetector(): Promise<Detect> {
  detectorPromise ??= (async (): Promise<Detect> => {
    const Native = (window as any).BarcodeDetector;
    if (Native?.getSupportedFormats) {
      try {
        const supported: string[] = await Native.getSupportedFormats();
        const formats = NATIVE_FORMATS.filter((f) => supported.includes(f));
        if (formats.includes('ean_13')) {
          const detector = new Native({ formats });
          return async (video) => ((await detector.detect(video)) as { rawValue: string }[])[0]?.rawValue ?? null;
        }
      } catch {
        /* lanjut ke ZXing */
      }
    }
    const z = await import('@zxing/library');
    const F = z.BarcodeFormat;
    const reader = new z.MultiFormatReader();
    reader.setHints(
      new Map<any, any>([
        [z.DecodeHintType.POSSIBLE_FORMATS, [F.EAN_13, F.EAN_8, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF, F.QR_CODE]],
        [z.DecodeHintType.TRY_HARDER, true],
      ]),
    );
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    return async (video) => {
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (!vw || !vh) return null;
      // Hanya area di dalam bingkai bidik, diperkecil agar dekode tetap cepat.
      const cw = Math.round(vw * 0.8);
      const ch = Math.round(vh * 0.6);
      const scale = Math.min(1, 960 / cw);
      const w = (canvas.width = Math.round(cw * scale));
      const h = (canvas.height = Math.round(ch * scale));
      ctx.drawImage(video, (vw - cw) / 2, (vh - ch) / 2, cw, ch, 0, 0, w, h);
      const { data } = ctx.getImageData(0, 0, w, h);
      const lum = new Uint8ClampedArray(w * h);
      for (let i = 0, j = 0; j < lum.length; i += 4, j++) lum[j] = (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) >> 8;
      try {
        return reader.decodeWithState(new z.BinaryBitmap(new z.HybridBinarizer(new z.RGBLuminanceSource(lum, w, h)))).getText();
      } catch {
        return null; // tidak ada barcode terbaca pada frame ini
      }
    };
  })();
  detectorPromise.catch(() => (detectorPromise = null));
  return detectorPromise;
}

/** EAN-8/UPC-A/EAN-13 dengan check digit benar cukup dibaca sekali; kode lain harus terbaca dua kali berturut-turut. */
function isValidGtin(code: string) {
  if (!/^(\d{8}|\d{12}|\d{13})$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((s, d, i) => s + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function cameraError(e: unknown) {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'Izin kamera ditolak. Klik ikon kamera atau gembok di address bar, izinkan kamera, lalu buka lagi.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError') return 'Kamera tidak ditemukan di perangkat ini.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'Kamera sedang dipakai aplikasi lain. Tutup aplikasi tersebut lalu coba lagi.';
  return `Kamera tidak dapat dibuka: ${(e as Error)?.message ?? String(e)}`;
}

const readStored = () => {
  try {
    return localStorage.getItem(CAMERA_KEY);
  } catch {
    return null;
  }
};

interface ScanLog {
  id: number;
  code: string;
  text: string;
  ok: boolean;
}

export interface CameraScanProps {
  open: boolean;
  onClose: () => void;
  /** Dipanggil untuk setiap kode yang terbaca. Kembalikan teks keterangan (mis. nama barang); lempar Error bila kode ditolak. */
  onDetected: (code: string) => unknown;
  /** true: kamera tetap terbuka untuk scan beruntun. false: tutup setelah satu kode diterima. */
  continuous?: boolean;
  title?: string;
  hint?: string;
}

export function CameraScanDialog({ open, onClose, onDetected, continuous = false, title = 'Scan dengan Kamera', hint }: CameraScanProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={title}
      subtitle={hint ?? (continuous ? 'Arahkan barcode ke dalam bingkai. Setiap barang yang terbaca langsung ditambahkan.' : 'Arahkan barcode ke dalam bingkai.')}
      footer={
        <button type="button" className={cx('btn', continuous ? 'btn-primary' : 'btn-secondary')} onClick={onClose}>
          {continuous ? 'Selesai' : 'Batal'}
        </button>
      }
    >
      {open && <ScannerView onDetected={onDetected} continuous={continuous} onDone={onClose} />}
    </Modal>
  );
}

function ScannerView({ onDetected, continuous, onDone }: { onDetected: CameraScanProps['onDetected']; continuous: boolean; onDone: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const callbacks = useRef({ onDetected, onDone, continuous });
  callbacks.current = { onDetected, onDone, continuous };
  const [state, setState] = useState<'starting' | 'scanning' | 'error'>('starting');
  const [error, setError] = useState<string | null>(null);
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState<string | null>(readStored);
  const [activeId, setActiveId] = useState('');
  const [torch, setTorch] = useState<{ supported: boolean; on: boolean }>({ supported: false, on: false });
  const [log, setLog] = useState<ScanLog[]>([]);
  const [flash, setFlash] = useState<'ok' | 'error' | null>(null);

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let timer = 0;
    let flashTimer = 0;
    setState('starting');
    setError(null);

    const fail = (message: string) => {
      if (stopped) return;
      setState('error');
      setError(message);
    };

    const accept = async (code: string) => {
      let entry: ScanLog;
      try {
        const text = await callbacks.current.onDetected(code);
        entry = { id: Date.now(), code, text: typeof text === 'string' ? text : code, ok: true };
        beep('ok');
      } catch (e) {
        entry = { id: Date.now(), code, text: (e as Error).message, ok: false };
        beep('error');
      }
      if (stopped) return;
      setLog((l) => [entry, ...l].slice(0, 5));
      setFlash(entry.ok ? 'ok' : 'error');
      clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => setFlash(null), 450);
      if (entry.ok && !callbacks.current.continuous) callbacks.current.onDone();
    };

    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        return fail(
          'Browser hanya mengizinkan kamera pada alamat https:// atau http://localhost. Buka aplikasi lewat localhost di komputer ini, atau jalankan server dengan HTTPS agar kamera HP/tablet bisa dipakai.',
        );
      }
      let detect: Detect;
      try {
        const size = { width: { ideal: 1280 }, height: { ideal: 720 } };
        const [d, s] = await Promise.all([
          createDetector(),
          navigator.mediaDevices.getUserMedia({ audio: false, video: deviceId ? { deviceId: { ideal: deviceId }, ...size } : { facingMode: { ideal: 'environment' }, ...size } }),
        ]);
        detect = d;
        stream = s;
      } catch (e) {
        return fail(cameraError(e));
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());

      const track = stream.getVideoTracks()[0];
      trackRef.current = track;
      setActiveId(track.getSettings().deviceId ?? '');
      await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {});
      const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
      setTorch({ supported: !!caps.torch, on: false });
      navigator.mediaDevices
        .enumerateDevices()
        .then((list) => !stopped && setCameras(list.filter((d) => d.kind === 'videoinput')))
        .catch(() => {});

      const video = videoRef.current!;
      video.srcObject = stream;
      try {
        await video.play();
      } catch (e) {
        return fail(cameraError(e));
      }
      if (stopped) return;
      setState('scanning');

      let candidate = { code: '', count: 0, at: 0 };
      let last = { code: '', seen: 0 };
      const tick = async () => {
        if (stopped) return;
        const code = video.readyState >= 2 ? await detect(video).catch(() => null) : null;
        const now = performance.now();
        if (code && !stopped) {
          if (code === last.code && now - last.seen < SAME_CODE_GAP_MS) {
            last.seen = now; // barang yang sama masih di depan kamera
          } else {
            candidate = code === candidate.code && now - candidate.at < 800 ? { code, count: candidate.count + 1, at: now } : { code, count: 1, at: now };
            if (isValidGtin(code) || candidate.count >= 2) {
              candidate = { code: '', count: 0, at: 0 };
              last = { code, seen: now };
              await accept(code);
              last.seen = performance.now();
            }
          }
        }
        if (!stopped) timer = window.setTimeout(tick, SCAN_INTERVAL_MS);
      };
      tick();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      clearTimeout(flashTimer);
      stream?.getTracks().forEach((t) => t.stop());
      trackRef.current = null;
    };
  }, [deviceId]);

  const toggleTorch = async () => {
    const track = trackRef.current;
    if (!track) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torch.on } as MediaTrackConstraintSet] });
      setTorch((t) => ({ ...t, on: !t.on }));
    } catch {
      setTorch({ supported: false, on: false });
    }
  };

  const chooseCamera = (id: string) => {
    try {
      localStorage.setItem(CAMERA_KEY, id);
    } catch {
      /* pilihan kamera hanya berlaku sampai halaman ditutup */
    }
    setDeviceId(id);
  };

  return (
    <div className="space-y-3">
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-slate-900 sm:aspect-video">
        <video ref={videoRef} className="size-full object-cover" playsInline muted autoPlay />
        {state === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div
              className={cx(
                'relative h-[60%] w-[80%] rounded-lg border-2 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] transition-colors',
                flash === 'ok' ? 'border-emerald-400' : flash === 'error' ? 'border-rose-500' : 'border-white/80',
              )}
            >
              <div className="absolute inset-x-3 top-1/2 h-0.5 animate-pulse bg-rose-500/80" />
            </div>
          </div>
        )}
        {state === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-slate-300">
            <Spinner className="size-6" /> Membuka kamera…
          </div>
        )}
        {state === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-sm text-slate-200">
            <Camera className="size-8 text-slate-400" />
            <p>{error}</p>
          </div>
        )}
        {torch.supported && (
          <button
            type="button"
            onClick={toggleTorch}
            className={cx('absolute right-3 bottom-3 rounded-full p-2.5 shadow', torch.on ? 'bg-amber-400 text-slate-900' : 'bg-slate-900/70 text-white')}
            aria-label={torch.on ? 'Matikan lampu' : 'Nyalakan lampu'}
          >
            <Flashlight className="size-5" />
          </button>
        )}
      </div>

      {cameras.length > 1 && (
        <select className="input" value={activeId} onChange={(e) => chooseCamera(e.target.value)} aria-label="Pilih kamera">
          {cameras.map((c, i) => (
            <option key={c.deviceId} value={c.deviceId}>
              {c.label || `Kamera ${i + 1}`}
            </option>
          ))}
        </select>
      )}

      {log.length > 0 ? (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
          {log.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              {l.ok ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <XCircle className="size-4 shrink-0 text-rose-600" />}
              <span className={cx('min-w-0 flex-1 truncate', l.ok ? 'text-slate-800' : 'text-rose-700')}>{l.text}</span>
              <span className="font-mono text-xs text-slate-400">{l.code}</span>
            </li>
          ))}
        </ul>
      ) : (
        state === 'scanning' && <p className="text-center text-xs text-slate-500">Jarak ideal 10–20 cm, barcode tegak lurus dan tidak silau.</p>
      )}
    </div>
  );
}

/** Tombol ikon kamera yang membuka pemindai; dipasang di samping kolom kode. */
export function CameraButton({ onDetected, multiple = false, title, hint, className }: Omit<CameraScanProps, 'open' | 'onClose' | 'continuous'> & { multiple?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cx('btn btn-secondary px-2.5', className)} onClick={() => setOpen(true)} title="Scan dengan kamera" aria-label="Scan dengan kamera">
        <Camera className="size-4" />
      </button>
      <CameraScanDialog open={open} onClose={() => setOpen(false)} onDetected={onDetected} continuous={multiple} title={title} hint={hint} />
    </>
  );
}
