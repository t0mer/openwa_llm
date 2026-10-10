export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

const R = 48;
const STROKE = 14;
export const RING_CIRCUMFERENCE = 2 * Math.PI * R;

function percent(value: number, total: number) {
  if (total <= 0 || value <= 0) return "0%";
  const p = (value / total) * 100;
  return p < 1 ? "<1%" : `${Math.round(p)}%`;
}

/**
 * A ring split by share, with a legend that always states each label, count and percentage
 * (colour never carries the meaning alone). All-zero data draws an empty ring marked "No data".
 */
export function Donut({ segments }: { segments: DonutSegment[] }) {
  const values = segments.map((s) => Math.max(s.value, 0));
  const total = values.reduce((a, b) => a + b, 0);
  let start = 0;
  const arcs = segments.flatMap((s, i) => {
    const len = total > 0 ? (values[i]! / total) * RING_CIRCUMFERENCE : 0;
    const from = start;
    start += len;
    return len > 0 ? [{ s, len, from, key: i }] : [];
  });

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <div className="relative size-36 shrink-0">
        <svg viewBox="0 0 120 120" aria-hidden="true" className="size-full">
          <circle cx="60" cy="60" r={R} fill="none" stroke="var(--surface-2)" strokeWidth={STROKE} />
          {arcs.map(({ s, len, from, key }) => (
            <circle
              key={key}
              data-arc=""
              cx="60"
              cy="60"
              r={R}
              fill="none"
              stroke={s.color}
              strokeWidth={STROKE}
              strokeDasharray={`${len} ${RING_CIRCUMFERENCE}`}
              transform={`rotate(${-90 + (from / RING_CIRCUMFERENCE) * 360} 60 60)`}
            />
          ))}
        </svg>
        <div className="absolute inset-0 grid place-items-center text-center">
          {total > 0 ? (
            <span data-testid="donut-total" className="tabular text-xl font-semibold">
              {total.toLocaleString()}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">No data</span>
          )}
        </div>
      </div>
      <ul className="flex min-w-0 flex-col gap-2 text-sm">
        {segments.map((s, i) => (
          <li key={i} className="flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="size-3 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <bdi dir="auto" title={s.label} className="block min-w-0 max-w-[12rem] truncate">
              {s.label}
            </bdi>
            <span className="tabular ms-auto ps-3 font-medium">{values[i]!.toLocaleString()}</span>
            <span className="tabular w-12 text-end text-muted-foreground">{percent(values[i]!, total)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
