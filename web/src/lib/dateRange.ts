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

export function resolveRange(
  key: RangeKey,
  now: Date,
  custom?: CustomRange,
): { from?: string; to?: string } | { error: string } {
  if (key === "all") return {};
  if (key !== "custom") {
    return { from: new Date(now.getTime() - PRESET_MS[key]).toISOString(), to: now.toISOString() };
  }
  const from = custom && parseDay(custom.from);
  const to = custom && parseDay(custom.to);
  if (!from || !to) return { error: "Enter a valid start and end date." };
  const start = new Date(from[0], from[1], from[2], 0, 0, 0, 0);
  const end = new Date(to[0], to[1], to[2], 23, 59, 59, 999);
  if (start.getTime() > end.getTime()) return { error: "The start date must not be after the end date." };
  return { from: start.toISOString(), to: end.toISOString() };
}

export function parseRangeParams(search: URLSearchParams): { key: RangeKey; custom?: CustomRange } {
  const key = search.get("range") ?? "";
  if (!KEYS.includes(key)) return { key: DEFAULT_KEY };
  if (key !== "custom") return { key: key as RangeKey };
  const from = search.get("from") ?? "";
  const to = search.get("to") ?? "";
  if (!parseDay(from) || !parseDay(to)) return { key: DEFAULT_KEY };
  return { key: "custom", custom: { from, to } };
}

export function rangeToParams(key: RangeKey, custom?: CustomRange): URLSearchParams {
  if (key === "custom") {
    if (custom && parseDay(custom.from) && parseDay(custom.to)) {
      return new URLSearchParams({ range: "custom", from: custom.from, to: custom.to });
    }
    return new URLSearchParams({ range: DEFAULT_KEY });
  }
  return new URLSearchParams({ range: key });
}
