import { useRef, useState, type KeyboardEvent } from "react";
import { useWidth } from "./useWidth";
import { count } from "./values";

export interface Bar {
  /** Short x-axis label ("14 Oct", "09"). */
  label: string;
  value: number;
  /** Full sentence for the bar's aria-label and tooltip ("Tue 14 Oct: 42 messages"). Build it from
   * `count(value)` so it states the same number the bar and the table show. */
  title: string;
}

const H = 200;
const PAD_TOP = 12;
const PAD_BOTTOM = 28;
const PAD_RIGHT = 8;
const PLOT_H = H - PAD_TOP - PAD_BOTTOM;
/** Rough width of one character of the 11px axis labels, plus the gap kept between labels. */
const CHAR_W = 6;
const LABEL_GAP = 6;
const TOOLTIP_HALF = 88; // max-w-44 / 2

/**
 * The smallest "round" axis maximum >= n whose half is a whole number, so the three gridlines
 * (0, half, max) all get integer labels: 4, 8, 10, then 1/2/4/5 x 10^k (20, 40, 50, 100, ...).
 */
export function niceMax(n: number): number {
  if (!Number.isFinite(n) || n <= 4) return 4; // NaN/Infinity would never find a scale
  if (n <= 8) return 8;
  if (n <= 10) return 10;
  let scale = 10 ** Math.floor(Math.log10(n));
  for (;;) {
    for (const m of [1, 2, 4, 5]) if (m * scale >= n) return m * scale;
    scale *= 10;
  }
}

/**
 * A single-series SVG bar chart. Width follows the container; x labels thin out as bars get
 * narrow (never below `xLabelEvery`). The chart is one tab stop: arrow keys, Home and End move
 * between bars, and each bar carries its `title` as aria-label and as the hover/focus tooltip.
 * Hover wins over keyboard focus; when the pointer leaves, the focused bar's tooltip returns.
 * Values that are negative or not finite are drawn as 0 (see `count`). Nothing animates, so reduced motion needs no special case.
 */
export function BarChart({
  data,
  color = "var(--chart-1)",
  xLabelEvery,
}: {
  data: Bar[];
  color?: string;
  xLabelEvery?: number;
}) {
  const [ref, width] = useWidth();
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // Indices left over from bars the data no longer has are cleared (not just ignored), so a ghost
  // tooltip never comes back when the data grows again.
  if (hovered !== null && hovered >= data.length) setHovered(null);
  if (focused !== null && focused >= data.length) setFocused(null);
  const active = [hovered, focused].find((i) => i !== null && i < data.length) ?? null;
  const [stop, setStop] = useState(0);
  const hits = useRef<(SVGGElement | null)[]>([]);

  const values = data.map((d) => count(d.value));
  const max = niceMax(Math.max(0, ...values));
  const ticks = [0, max / 2, max];
  const padLeft = Math.max(24, max.toLocaleString().length * CHAR_W + 10);
  const plotW = Math.max(width - padLeft - PAD_RIGHT, 10);
  const n = data.length;
  const step = plotW / Math.max(n, 1);
  const barW = Math.min(Math.max(step * 0.65, Math.min(step, 1)), 32);
  const y = (v: number) => PAD_TOP + PLOT_H - (v / max) * PLOT_H;
  const centre = (i: number) => padLeft + step * i + step / 2;

  const labelW = Math.max(0, ...data.map((d) => d.label.length)) * CHAR_W;
  const minEvery = Math.max(1, Math.floor(xLabelEvery ?? 1));
  const auto = Math.max(1, Math.ceil((labelW + LABEL_GAP) / step));
  const every = Math.ceil(auto / minEvery) * minEvery;
  const labelX = (i: number) => Math.min(Math.max(centre(i), labelW / 2), width - labelW / 2);

  const tabStop = Math.min(stop, Math.max(n - 1, 0));
  const move = (to: number) => {
    const i = Math.min(Math.max(to, 0), n - 1);
    setStop(i);
    hits.current[i]?.focus();
  };
  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const to = { ArrowRight: i + 1, ArrowDown: i + 1, ArrowLeft: i - 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    move(to);
  };

  const hover = active === null ? null : data[active];
  const tipLeft = active === null ? 0 : width < TOOLTIP_HALF * 2 ? width / 2 : Math.min(Math.max(centre(active), TOOLTIP_HALF), width - TOOLTIP_HALF);

  return (
    <div ref={ref} dir="ltr" className="relative w-full">
      <svg width={width} height={H} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line
              data-grid=""
              {...(t === 0 ? { "data-baseline": "" } : {})}
              x1={padLeft}
              x2={width - PAD_RIGHT}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "var(--border-strong)" : "var(--border)"}
              strokeWidth="1"
              strokeDasharray={t === 0 ? undefined : "3 4"}
            />
            <text data-ytick="" x={padLeft - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted-foreground)" className="tabular">
              {t.toLocaleString()}
            </text>
          </g>
        ))}
        {data.map((d, i) => {
          const v = values[i]!;
          const h = v > 0 ? Math.max((v / max) * PLOT_H, 1) : 0;
          return (
            <g
              key={i}
              ref={(el) => {
                hits.current[i] = el;
              }}
              data-bar-hit=""
              role="img"
              aria-label={d.title}
              tabIndex={i === tabStop ? 0 : -1}
              onFocus={() => {
                setStop(i);
                setFocused(i);
              }}
              onBlur={() => setFocused(null)}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className="outline-none [&:focus-visible_.hit]:stroke-ring"
            >
              <rect className="hit" x={padLeft + step * i} y={PAD_TOP} width={step} height={PLOT_H} fill="transparent" stroke="transparent" strokeWidth="2" rx="3" />
              {h > 0 && (
                <rect
                  data-bar=""
                  x={centre(i) - barW / 2}
                  y={PAD_TOP + PLOT_H - h}
                  width={barW}
                  height={h}
                  rx={Math.min(2, barW / 2)}
                  fill={color}
                  opacity={active === null || active === i ? 1 : 0.55}
                  className="transition-opacity"
                />
              )}
              {i % every === 0 && (
                <text data-xlabel="" x={labelX(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--muted-foreground)">
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hover && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute top-0 z-10 w-max max-w-44 -translate-x-1/2 rounded-md border bg-surface px-2.5 py-1.5 text-xs font-medium shadow-overlay"
          style={{ left: tipLeft }}
        >
          <p className="tabular">{hover.title}</p>
        </div>
      )}
    </div>
  );
}
