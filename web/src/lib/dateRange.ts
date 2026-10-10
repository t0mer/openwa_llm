export type RangeKey = "24h" | "7d" | "30d" | "90d" | "all" | "custom";
export interface CustomRange {
  from: string;
  to: string;
}

const PRESET_MS = {
  "24h": 24 * 3600e3,
  "7d": 7 * 86400e3,
  "30d": 30 * 86400e3,
  "90d": 90 * 86400e3,
} as const;
const DEFAULT_KEY: RangeKey = "7d";
const KEYS: readonly string[] = ["24h", "7d", "30d", "90d", "all", "custom"];

/** Parse a local `YYYY-MM-DD` into [y, m(0-based), d], or null when malformed or not a real date. */
function parseDay(text: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const probe = new Date(y, mo, d);
  return probe.getFullYear() === y && probe.getMonth() === mo && probe.getDate() === d ? [y, mo, d] : null;
}

type Day = [number, number, number];

/**
 * The single place that validates a custom range: both days real and start not after end.
 * Custom days are browser-local; chart buckets use the server timezone (the page shows stats.timezone).
 */
function customBounds(custom?: CustomRange): { start: Date; end: Date } | { error: string } {
  const from: Day | null = custom ? parseDay(custom.from) : null;
  const to: Day | null = custom ? parseDay(custom.to) : null;
  if (!from || !to) return { error: "Enter a valid start and end date." };
  const start = new Date(from[0], from[1], from[2], 0, 0, 0, 0);
  const end = new Date(to[0], to[1], to[2], 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) return { error: "The start date must not be after the end date." };
  return { start, end };
}

/**
 * Preset ranges are anchored on `now` at call time, so callers must compute `now` inside the
 * load effect, not in a render-time dependency.
 */
export function resolveRange(
  key: RangeKey,
  now: Date,
  custom?: CustomRange,
): { from?: string; to?: string } | { error: string } {
  if (key === "all") return {};
  if (key !== "custom") {
    return { from: new Date(now.getTime() - PRESET_MS[key]).toISOString(), to: now.toISOString() };
  }
  const b = customBounds(custom);
  if ("error" in b) return b;
  return { from: b.start.toISOString(), to: b.end.toISOString() };
}

export function parseRangeParams(search: URLSearchParams): { key: RangeKey; custom?: CustomRange } {
  const key = search.get("range") ?? "";
  if (!KEYS.includes(key)) return { key: DEFAULT_KEY };
  if (key !== "custom") return { key: key as RangeKey };
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  const custom = { from, to };
  if ("error" in customBounds(custom)) return { key: DEFAULT_KEY };
  return { key: "custom", custom };
}

export function rangeToParams(key: RangeKey, custom?: CustomRange): URLSearchParams {
  if (key === "custom") {
    if (custom && !("error" in customBounds(custom))) {
      return new URLSearchParams({ range: "custom", from: custom.from, to: custom.to });
    }
    return new URLSearchParams({ range: DEFAULT_KEY });
  }
  return new URLSearchParams({ range: key });
}
