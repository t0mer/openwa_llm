import { useCallback, useId, useMemo, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { parseRangeParams, rangeToParams, resolveRange, type CustomRange, type RangeKey } from "../lib/dateRange";
import { Button } from "./ui/button";
import { Field, Input } from "./ui/field";
import { FilterChip } from "./ui/filter-chip";
import { InlineError } from "./ui/inline-error";

const PRESETS: { key: Exclude<RangeKey, "custom">; label: string }[] = [
  { key: "24h", label: "24 hours" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "all", label: "All time" },
];

export type RangeChange = (key: RangeKey, custom?: CustomRange) => void;

/**
 * The dashboard range lives in the URL (`?range=7d`, `?range=custom&from=…&to=…`) so reloads and
 * links keep it. Changes replace the history entry, so Back leaves the page instead of stepping
 * through every range tried.
 */
export function useRangeParams(): [{ key: RangeKey; custom?: CustomRange }, RangeChange] {
  const [search, setSearch] = useSearchParams();
  const text = search.toString();
  const range = useMemo(() => parseRangeParams(new URLSearchParams(text)), [text]);
  const setRange = useCallback<RangeChange>(
    (key, custom) => setSearch(rangeToParams(key, custom), { replace: true }),
    [setSearch],
  );
  return [range, setRange];
}

/**
 * Preset chips plus a Custom chip that opens From/To date inputs (browser-local days, the end
 * day inclusive). An invalid or reversed custom range shows an inline error and is not applied.
 */
export function DateRangeFilter({
  rangeKey,
  custom,
  onChange,
}: {
  rangeKey: RangeKey;
  custom?: CustomRange;
  onChange: RangeChange;
}) {
  const [open, setOpen] = useState(rangeKey === "custom");
  const [draft, setDraft] = useState<CustomRange>(custom ?? { from: "", to: "" });
  const [error, setError] = useState<string | null>(null);
  const panelId = useId();
  const errorId = useId();

  function pick(key: Exclude<RangeKey, "custom">) {
    setOpen(false);
    setError(null);
    onChange(key, undefined);
  }

  function apply(e: FormEvent) {
    e.preventDefault();
    const r = resolveRange("custom", new Date(), draft);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    setError(null);
    onChange("custom", { ...draft });
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Date range" className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <FilterChip key={p.key} active={rangeKey === p.key} onClick={() => pick(p.key)}>
            {p.label}
          </FilterChip>
        ))}
        <FilterChip
          active={rangeKey === "custom"}
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((o) => !o)}
        >
          Custom
        </FilterChip>
      </div>
      {open && (
        <form
          id={panelId}
          aria-label="Custom date range"
          noValidate
          className="flex flex-col gap-2"
          onSubmit={apply}
        >
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end">
            <Field label="From" className="sm:w-48">
              <Input
                type="date"
                value={draft.from}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setDraft({ ...draft, from: e.target.value })}
              />
            </Field>
            <Field label="To" className="sm:w-48">
              <Input
                type="date"
                value={draft.to}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => setDraft({ ...draft, to: e.target.value })}
              />
            </Field>
            <Button type="submit" variant="primary" size="lg">
              Apply
            </Button>
          </div>
          {error && (
            <div id={errorId}>
              <InlineError>{error}</InlineError>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
