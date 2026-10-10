import { useCallback, useEffect, useRef, useState } from "react";
import { Info, MessageSquare, RotateCw } from "lucide-react";
import { ApiError, api } from "../api";
import { BarChart, type Bar } from "../components/charts/BarChart";
import { ChartCard } from "../components/charts/ChartCard";
import { Donut } from "../components/charts/Donut";
import { HBarList } from "../components/charts/HBarList";
import { count } from "../components/charts/values";
import { DateRangeFilter, useRangeParams } from "../components/DateRangeFilter";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { LG_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { resolveRange, type RangeKey } from "../lib/dateRange";
import { cn } from "../lib/cn";
import type { Stats, StatsBucket } from "../types";
import { useLoadError } from "../useLoad";

const REFRESH_MS = 60_000;
const RELATIVE: readonly RangeKey[] = ["24h", "7d", "30d", "90d"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const messages = (v: number) => {
  const n = count(v);
  return `${n.toLocaleString()} ${n === 1 ? "message" : "messages"}`;
};

/** A name, or the JID's user part ("972501234567" from "972501234567@s.whatsapp.net") when it is null or empty. */
const nameOrJid = (name: string | null, jid: string) => name || jid.split("@")[0] || jid;

/** Date formatters in the server time zone (buckets are computed there); browser zone if it is unknown. */
function formatters(timeZone: string) {
  const make = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat("en-GB", { ...o, timeZone });
    } catch {
      return new Intl.DateTimeFormat("en-GB", o);
    }
  };
  return {
    day: make({ weekday: "short", day: "numeric", month: "short" }),
    shortDay: make({ day: "numeric", month: "short" }),
    hour: make({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    dayHour: make({ weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }),
    month: make({ month: "short", year: "numeric" }),
  };
}

/** Axis label and full label for a series point, per bucket. Week buckets start on Monday. */
function bucketLabels(bucket: StatsBucket, timeZone: string) {
  const f = formatters(timeZone);
  return (start: string): { short: string; long: string } => {
    const d = new Date(start);
    switch (bucket) {
      case "hour":
        return { short: f.hour.format(d), long: f.dayHour.format(d) };
      case "week":
        return { short: f.shortDay.format(d), long: `Week of ${f.day.format(d)}` };
      case "month":
        return { short: f.month.format(d), long: f.month.format(d) };
      default:
        return { short: f.shortDay.format(d), long: f.day.format(d) };
    }
  };
}

const BUCKET_NAMES: Record<StatsBucket, string> = {
  hour: "Per hour",
  day: "Per day",
  week: "Per week (weeks start on Monday)",
  month: "Per month",
};

/** "Name: 1,234 messages in total, most in Wed 14 Oct (42)" for a bar chart's group label. */
function peakSummary(name: string, bars: Bar[], labels: string[]) {
  const values = bars.map((b) => count(b.value));
  const total = values.reduce((a, b) => a + b, 0);
  if (total === 0) return `${name}: no messages`;
  const peak = values.indexOf(Math.max(...values));
  return `${name}: ${messages(total)} in total, most in ${labels[peak]} (${values[peak]!.toLocaleString()})`;
}

function Tile({ label, note, value, sub }: { label: string; note?: string; value: number; sub?: string }) {
  return (
    <div className="flex flex-col gap-1.5 px-4 py-3 sm:px-5">
      <dt className="text-sm text-muted-foreground">
        <span>{label}</span>
        {note && <span className="block text-xs">{note}</span>}
      </dt>
      <dd className="tabular text-2xl font-semibold leading-none">{count(value).toLocaleString()}</dd>
      {sub && <dd className="text-xs text-muted-foreground">{sub}</dd>}
    </div>
  );
}

function Tiles({ s }: { s: Stats }) {
  return (
    <section aria-labelledby="dashboard-summary">
      <h2 id="dashboard-summary" className="sr-only">
        Summary
      </h2>
      <dl className="grid grid-cols-2 divide-x divide-y rounded-md border sm:grid-cols-3 lg:grid-cols-4 rtl:divide-x-reverse">
        <Tile label="Groups" note="All time" value={s.groups.total} sub={`${count(s.groups.managed).toLocaleString()} managed`} />
        <Tile label="Chats" value={s.chats} />
        <Tile label="Messages" value={s.messages} />
        <Tile label="Active senders" value={s.active_senders} />
        <Tile label="Reactions" value={s.reactions} />
        <Tile label="Knowledge-base topics" value={s.kb_topics} />
      </dl>
    </section>
  );
}

const listSummary = (name: string, items: { label: string; value: number }[]) =>
  items.length === 0
    ? `${name}: no data`
    : `${name}: ${items.map((i) => `${i.label} ${count(i.value).toLocaleString()}`).join(", ")}`;

function Charts({ s, wide }: { s: Stats; wide: boolean }) {
  const label = bucketLabels(s.bucket, s.timezone);
  const points = s.series.map((p) => ({ ...label(p.start), value: p.count }));
  const series: Bar[] = points.map((p) => ({ label: p.short, value: p.value, title: `${p.long}: ${messages(p.value)}` }));

  const hh = (h: number) => String(h).padStart(2, "0");
  // Fixed slots: 24 hours and 7 days (missing entries count as 0, extras are ignored).
  const hourNames = Array.from({ length: 24 }, (_, h) => `${hh(h)}:00–${hh((h + 1) % 24)}:00`);
  const hours: Bar[] = hourNames.map((name, h) => {
    const v = s.by_hour[h] ?? 0;
    return { label: hh(h), value: v, title: `${name}: ${messages(v)}` };
  });
  const days: Bar[] = WEEKDAYS.map((name, d) => {
    const v = s.by_weekday[d] ?? 0;
    return { label: name.slice(0, 3), value: v, title: `${name}: ${messages(v)}` };
  });

  const groups = s.top_groups.map((g) => ({ key: g.group_jid, label: nameOrJid(g.name, g.group_jid), value: g.count }));
  const senders = s.top_senders.map((g) => ({ key: g.sender_jid, label: nameOrJid(g.name, g.sender_jid), value: g.count }));

  const split = [
    { label: "Text", value: s.split.text, color: "var(--chart-1)" },
    { label: "Media", value: s.split.media, color: "var(--chart-2)" },
    ...(count(s.split.other) > 0 ? [{ label: "Other", value: s.split.other, color: "var(--chart-3)" }] : []),
  ];

  return (
    <div data-testid="chart-grid" className={cn("grid gap-4", wide ? "grid-cols-2" : "grid-cols-1")}>
      <ChartCard
        className={cn(wide && "col-span-2")}
        title="Messages over time"
        description={BUCKET_NAMES[s.bucket]}
        summary={peakSummary("Messages over time", series, points.map((p) => p.long))}
        table={{ columns: ["Period", "Messages"], rows: points.map((p) => [p.long, p.value]) }}
      >
        <BarChart data={series} />
      </ChartCard>
      <ChartCard
        title="Top 5 groups"
        summary={listSummary("Top 5 groups", groups)}
        table={{ columns: ["Group", "Messages"], rows: groups.map((g) => [g.label, g.value]) }}
      >
        <HBarList items={groups} />
      </ChartCard>
      <ChartCard
        title="Top senders"
        summary={listSummary("Top senders", senders)}
        table={{ columns: ["Sender", "Messages"], rows: senders.map((g) => [g.label, g.value]) }}
      >
        <HBarList items={senders} />
      </ChartCard>
      <ChartCard
        title="Activity by hour of day"
        summary={peakSummary("Activity by hour of day", hours, hourNames)}
        table={{ columns: ["Hour", "Messages"], rows: hours.map((h, i) => [hourNames[i]!, h.value]) }}
      >
        <BarChart data={hours} color="var(--chart-2)" xLabelEvery={3} />
      </ChartCard>
      <ChartCard
        title="Activity by weekday"
        summary={peakSummary("Activity by weekday", days, WEEKDAYS)}
        table={{ columns: ["Day", "Messages"], rows: days.map((d, i) => [WEEKDAYS[i]!, d.value]) }}
      >
        <BarChart data={days} color="var(--chart-4)" />
      </ChartCard>
      <ChartCard
        title="Text vs media"
        summary={`Text vs media: ${split.map((p) => `${p.label} ${count(p.value).toLocaleString()}`).join(", ")}`}
        table={{ columns: ["Kind", "Messages"], rows: split.map((p) => [p.label, p.value]) }}
      >
        <Donut segments={split} />
      </ChartCard>
    </div>
  );
}

function Loading() {
  return (
    <div role="status" aria-label="Loading the dashboard" className="flex flex-col gap-4">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-40 rounded-md" />
      <Skeleton className="h-64 rounded-lg" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
    </div>
  );
}

interface Result {
  /** The range this result belongs to; a result for another range is never shown. */
  range: string;
  stats: Stats | null;
  error: string | null;
}

export default function Dashboard() {
  const wide = useMediaQuery(LG_QUERY);
  const [{ key, custom }, setRange] = useRangeParams();
  const cFrom = custom?.from ?? "";
  const cTo = custom?.to ?? "";
  const rangeId = `${key}|${cFrom}|${cTo}`;
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  /** Resolves true when this request's result was applied. */
  const load = useCallback(async (): Promise<boolean> => {
    // Presets are anchored on the moment of each request, so every refresh moves the window.
    const params = resolveRange(key, new Date(), key === "custom" ? { from: cFrom, to: cTo } : undefined);
    if ("error" in params) return false; // the URL parser only yields valid ranges
    const id = ++seq.current;
    setBusy(true);
    try {
      const stats = await api.getStats(params);
      if (id !== seq.current) return false; // a newer request (or range) owns the page now
      setResult({ range: rangeId, stats, error: null });
      setBusy(false);
      return true;
    } catch (e) {
      if (id !== seq.current) return false;
      // 401 is handled by the session layer (redirect to login), like useLoad.
      if (!(e instanceof ApiError && e.status === 401)) {
        const error = e instanceof Error ? e.message : String(e);
        setResult((prev) => ({ range: rangeId, stats: prev?.range === rangeId ? prev.stats : null, error }));
      }
    }
    setBusy(false);
    return false;
  }, [key, cFrom, cTo, rangeId]);

  useEffect(() => {
    void load();
    const stale = () => {
      seq.current++; // any response still in flight belongs to the old range
    };
    if (!RELATIVE.includes(key)) return stale;
    // Relative presets refresh every minute while the tab is visible; a tick missed while it was
    // hidden is made up once when it is shown again. Custom and All time are fixed windows.
    let missed = false;
    const tick = () => {
      if (document.visibilityState === "visible") void load();
      else missed = true;
    };
    let timer = setInterval(tick, REFRESH_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible" && missed) {
        missed = false;
        void load();
        // Restart the minute from the catch-up, so a scheduled tick does not follow right behind it.
        clearInterval(timer);
        timer = setInterval(tick, REFRESH_MS);
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stale();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [load, key]);

  const page = useRef<HTMLDivElement>(null);
  const [retrying, setRetrying] = useState(false);
  async function retry() {
    setRetrying(true);
    const ok = await load();
    setRetrying(false);
    // The Retry button disappears with the error; move focus to the heading instead of <body>.
    const h1 = ok ? page.current?.querySelector("h1") : null;
    if (h1) {
      h1.tabIndex = -1;
      h1.focus();
    }
  }

  const current = result?.range === rangeId ? result : null;
  const stats = current?.stats ?? null;
  // First-load failures render inline with Retry; a failed refresh is toasted and the numbers stay.
  const inlineError = useLoadError(current?.error ?? null, stats !== null);

  return (
    <div ref={page} className="flex flex-col gap-5">
      <PageHeader title="Dashboard" description="Activity across the groups and chats the bot can see." />
      <div className="flex flex-col gap-2">
        <DateRangeFilter rangeKey={key} custom={custom} onChange={setRange} />
        {stats && <p className="text-xs text-muted-foreground">Times in {stats.timezone}</p>}
      </div>
      {inlineError ? (
        <div aria-busy={retrying || undefined} className="flex flex-col items-start gap-3">
          <InlineError className="w-full">{inlineError}</InlineError>
          <div className="flex items-center gap-3">
            <Button onClick={() => void retry()} aria-disabled={busy || undefined}>
              <RotateCw aria-hidden="true" />
              Retry
            </Button>
            <span role="status" className="text-sm text-muted-foreground">
              {retrying ? "Loading…" : ""}
            </span>
          </div>
        </div>
      ) : !stats ? (
        <Loading />
      ) : (
        <div aria-busy={busy || undefined} className="flex flex-col gap-5">
          {!stats.bot_excluded && (
            <p className="flex items-start gap-2 rounded-md bg-surface-2 p-3 text-sm">
              <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              Bot messages could not be identified and are included
            </p>
          )}
          <Tiles s={stats} />
          {count(stats.messages) === 0 ? (
            <div className="rounded-lg border bg-surface">
              <EmptyState icon={MessageSquare} title="No messages in this range">
                Try a longer range, such as All time.
              </EmptyState>
            </div>
          ) : (
            <Charts s={stats} wide={wide} />
          )}
        </div>
      )}
    </div>
  );
}
