import { useCallback, useEffect, useRef, useState } from 'react';
import { get } from './api';

type Query = Record<string, string | number | boolean | null | undefined>;

/** Ambil data dari API; otomatis memuat ulang saat path/query berubah. */
export function useFetch<T = any>(path: string | null, query?: Query) {
  const key = path ? `${path}|${JSON.stringify(query ?? {})}` : null;
  const [data, setData] = useState<T | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const [tick, setTick] = useState(0);
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    if (!path) return;
    let alive = true;
    setLoading(true);
    get<T>(path, queryRef.current)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setError(null);
      })
      .catch((e) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [key, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}

export function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useClock(intervalMs = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Bunyi pendek untuk umpan balik scan (berhasil / gagal). */
let audioCtx: AudioContext | null = null;
export function beep(kind: 'ok' | 'error' = 'ok') {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = kind === 'ok' ? 'sine' : 'square';
    osc.frequency.value = kind === 'ok' ? 1650 : 220;
    gain.gain.value = kind === 'ok' ? 0.05 : 0.08;
    osc.connect(gain).connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + (kind === 'ok' ? 0.07 : 0.3));
  } catch {
    /* audio tidak tersedia */
  }
}
