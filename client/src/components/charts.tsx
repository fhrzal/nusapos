import { useEffect, useRef, useState, type ReactNode } from 'react';

// Grafik SVG ringan tanpa dependensi. Warna mengikuti palet tervalidasi (lihat index.css: --color-series-*).
export const SERIES = ['var(--color-series-1)', 'var(--color-series-2)', 'var(--color-series-3)', 'var(--color-series-4)'];

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function niceScale(max: number, ticks = 4) {
  if (max <= 0) return { max: 1, step: 0.25 };
  const raw = max / ticks;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!;
  return { max: step * Math.ceil(max / step), step };
}

const PAD = { top: 12, right: 12, bottom: 26, left: 56 };

function Tooltip({ x, y, width, children }: { x: number; y: number; width: number; children: ReactNode }) {
  const left = Math.min(Math.max(x, 80), width - 80);
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{ left, top: y - 8 }}
    >
      {children}
    </div>
  );
}

function YAxis({ scale, innerH, innerW, format }: { scale: { max: number; step: number }; innerH: number; innerW: number; format: (n: number) => string }) {
  const ticks: number[] = [];
  for (let v = 0; v <= scale.max + 1e-9; v += scale.step) ticks.push(v);
  return (
    <g>
      {ticks.map((t) => {
        const y = PAD.top + innerH - (t / scale.max) * innerH;
        return (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + innerW} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray={t === 0 ? undefined : '3 3'} />
            <text x={PAD.left - 8} y={y} dy="0.32em" textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
              {format(t)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

/** Grafik batang vertikal satu seri dengan tooltip per batang. */
export function BarChart({
  data,
  height = 240,
  format,
  axisFormat = format,
  color = SERIES[0],
  highlightLast,
}: {
  data: { label: string; value: number; detail?: ReactNode }[];
  height?: number;
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
  color?: string;
  highlightLast?: boolean;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const scale = niceScale(Math.max(0, ...data.map((d) => d.value)));
  const band = innerW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(36, band - 2));
  const every = Math.ceil(data.length / Math.max(1, Math.floor(innerW / 56)));

  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ minHeight: height }} onMouseLeave={() => setHover(null)}>
      <svg width={width} height={height} role="img" className="block">
        <YAxis scale={scale} innerH={innerH} innerW={innerW} format={axisFormat} />
        {data.map((d, i) => {
          const h = (d.value / scale.max) * innerH;
          const x = PAD.left + i * band + (band - barW) / 2;
          const y = PAD.top + innerH - h;
          const r = Math.min(4, barW / 2, h);
          const dim = hover !== null && hover !== i;
          const isLast = highlightLast && i === data.length - 1;
          return (
            <g key={i}>
              {h > 0 && (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill={color}
                  opacity={dim ? 0.45 : isLast ? 1 : 0.88}
                />
              )}
              {i % every === 0 && (
                <text x={x + barW / 2} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
                  {d.label}
                </text>
              )}
              <rect x={PAD.left + i * band} y={PAD.top} width={band} height={innerH} fill="transparent" onMouseEnter={() => setHover(i)} />
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tooltip x={PAD.left + hover * band + band / 2} y={PAD.top + innerH - (data[hover].value / scale.max) * innerH} width={width}>
          <div className="font-semibold text-slate-900">{data[hover].label}</div>
          <div className="tabular-nums text-slate-700">{format(data[hover].value)}</div>
          {data[hover].detail && <div className="text-slate-500">{data[hover].detail}</div>}
        </Tooltip>
      )}
    </div>
  );
}

/** Grafik garis multi-seri dengan crosshair & tooltip. */
export function LineChart({
  labels,
  series,
  height = 240,
  format,
  axisFormat = format,
}: {
  labels: string[];
  series: { name: string; values: number[]; color: string; dashed?: boolean }[];
  height?: number;
  format: (n: number) => string;
  axisFormat?: (n: number) => string;
}) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const innerW = Math.max(10, width - PAD.left - PAD.right);
  const innerH = height - PAD.top - PAD.bottom;
  const scale = niceScale(Math.max(0, ...series.flatMap((s) => s.values)));
  const step = labels.length > 1 ? innerW / (labels.length - 1) : innerW;
  const px = (i: number) => PAD.left + i * step;
  const py = (v: number) => PAD.top + innerH - (v / scale.max) * innerH;
  const every = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 48)));

  return (
    <div ref={ref} className="relative w-full min-w-0" onMouseLeave={() => setHover(null)}>
      <div className="mb-2 flex flex-wrap gap-4 text-xs text-slate-600">
        {series.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <svg width="18" height="8">
              <line x1="0" x2="18" y1="4" y2="4" stroke={s.color} strokeWidth="2" strokeDasharray={s.dashed ? '4 3' : undefined} />
            </svg>
            {s.name}
          </span>
        ))}
      </div>
      <svg
        width={width}
        height={height}
        className="block"
        role="img"
        onMouseMove={(e) => {
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.round((e.clientX - rect.left - PAD.left) / step);
          setHover(i >= 0 && i < labels.length ? i : null);
        }}
      >
        <YAxis scale={scale} innerH={innerH} innerW={innerW} format={axisFormat} />
        {labels.map(
          (l, i) =>
            i % every === 0 && (
              <text key={i} x={px(i)} y={height - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {l}
              </text>
            ),
        )}
        {hover !== null && <line x1={px(hover)} x2={px(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="#94a3b8" strokeWidth="1" />}
        {series.map((s) => (
          <g key={s.name}>
            <path
              d={s.values.map((v, i) => `${i ? 'L' : 'M'}${px(i)},${py(v)}`).join(' ')}
              fill="none"
              stroke={s.color}
              strokeWidth="2"
              strokeLinejoin="round"
              strokeDasharray={s.dashed ? '5 4' : undefined}
            />
            {hover !== null && s.values[hover] !== undefined && (
              <circle cx={px(hover)} cy={py(s.values[hover])} r="4.5" fill={s.color} stroke="white" strokeWidth="2" />
            )}
          </g>
        ))}
      </svg>
      {hover !== null && (
        <Tooltip x={px(hover)} y={PAD.top + 40} width={width}>
          <div className="mb-1 font-semibold text-slate-900">{labels[hover]}</div>
          {series.map((s) => (
            <div key={s.name} className="flex items-center gap-2 tabular-nums text-slate-700">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              <span className="text-slate-500">{s.name}</span>
              <span className="ml-auto pl-3 font-medium">{format(s.values[hover] ?? 0)}</span>
            </div>
          ))}
        </Tooltip>
      )}
    </div>
  );
}

/** Daftar batang horizontal (peringkat / komposisi). */
export function HBarList({
  items,
  format,
  color = SERIES[0],
  showShare,
}: {
  items: { label: ReactNode; value: number; sub?: ReactNode }[];
  format: (n: number) => string;
  color?: string;
  showShare?: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul className="space-y-2.5">
      {items.map((it, idx) => (
        <li key={idx} className="group" title={format(it.value)}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-slate-700">{it.label}</span>
            <span className="shrink-0 tabular-nums font-medium text-slate-900">
              {format(it.value)}
              {showShare && <span className="ml-1.5 text-xs font-normal text-slate-500">{((it.value / total) * 100).toFixed(1)}%</span>}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100">
            <div className="h-2 rounded-full transition-all group-hover:opacity-80" style={{ width: `${(it.value / max) * 100}%`, background: color }} />
          </div>
          {it.sub && <div className="mt-0.5 text-xs text-slate-500">{it.sub}</div>}
        </li>
      ))}
    </ul>
  );
}
