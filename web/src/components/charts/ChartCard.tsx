import { ChartColumn, Table2 } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { count } from "./values";

export interface ChartTable {
  columns: string[];
  rows: (string | number)[][];
}

function cell(v: string | number) {
  return typeof v === "number" ? count(v).toLocaleString() : v;
}

/**
 * A chart in a card. The chart is a group labelled by `summary` (a group, not an image, so its
 * focusable bars and legend stay exposed); "Show as table" swaps it for a table of the same numbers
 * (first column as row headers), so nothing is carried by the picture alone.
 */
export function ChartCard({
  title,
  description,
  summary,
  table,
  children,
  className,
}: {
  title: string;
  description?: string;
  summary: string;
  table: ChartTable;
  children: ReactNode;
  className?: string;
}) {
  const [asTable, setAsTable] = useState(false);
  const bodyId = useId();
  return (
    <section className={cn("flex min-w-0 flex-col gap-3 rounded-lg border bg-surface p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <button
          type="button"
          aria-controls={bodyId}
          onClick={() => setAsTable((t) => !t)}
          className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary hover:bg-primary-soft"
        >
          {asTable ? <ChartColumn aria-hidden="true" className="size-4" /> : <Table2 aria-hidden="true" className="size-4" />}
          {asTable ? "Show chart" : "Show as table"}
        </button>
      </div>
      <div id={bodyId} className="min-w-0">
        {asTable ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{summary}</caption>
              <thead>
                <tr className="text-muted-foreground">
                  {table.columns.map((c, i) => (
                    <th key={i} scope="col" className={cn("py-1.5 font-medium", i === 0 ? "pe-3 text-start" : "ps-3 text-end")}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((row, r) => (
                  <tr key={r} className="border-t">
                    {row.map((v, i) =>
                      i === 0 ? (
                        <th key={i} scope="row" className="max-w-[16rem] py-1.5 pe-3 text-start font-normal">
                          <bdi dir="auto" className="block truncate" title={String(v)}>
                            {cell(v)}
                          </bdi>
                        </th>
                      ) : (
                        <td key={i} className="tabular py-1.5 ps-3 text-end">
                          {cell(v)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div role="group" aria-label={summary}>
            {children}
          </div>
        )}
      </div>
    </section>
  );
}
