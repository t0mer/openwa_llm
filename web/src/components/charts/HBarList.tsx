import { count } from "./values";

export interface HBarItem {
  key: string;
  label: string;
  value: number;
}

/**
 * A ranked list of horizontal bars (top groups, top senders). Each name is isolated with
 * <bdi dir="auto"> so Hebrew and mixed-direction names render correctly, truncated with the full
 * name as a title; the count is always shown as a number next to it. Negative or non-finite
 * values count as 0 (see `count`).
 */
export function HBarList({ items }: { items: HBarItem[] }) {
  if (items.length === 0) return <p className="py-6 text-center text-sm text-muted-foreground">No data</p>;
  const max = Math.max(0, ...items.map((i) => count(i.value)));
  return (
    <ol className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col gap-1">
          <div className="flex items-baseline gap-3 text-sm">
            <bdi dir="auto" title={item.label} className="block min-w-0 flex-1 truncate">
              {item.label}
            </bdi>
            <span className="tabular shrink-0 text-end font-medium">{count(item.value).toLocaleString()}</span>
          </div>
          <div aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-surface-2">
            <div
              data-fill=""
              className="h-full rounded-full bg-chart-1"
              style={{ width: `${max > 0 ? (count(item.value) / max) * 100 : 0}%` }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}
