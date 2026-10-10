import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import Dashboard from "./Dashboard";
import { ApiError, api } from "../api";
import { mockViewport } from "../hooks/mockViewport";
import type { Stats } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { getStats: vi.fn() } };
});
vi.mock("../alerts");
import { toast } from "../alerts";

const NOW = new Date("2026-10-10T12:00:00Z");

function stats(over: Partial<Stats> = {}): Stats {
  return {
    from: "2026-10-03T12:00:00Z",
    to: "2026-10-10T12:00:00Z",
    timezone: "Asia/Jerusalem",
    bucket: "day",
    bot_excluded: true,
    groups: { total: 12, managed: 3 },
    chats: 15,
    messages: 1234,
    active_senders: 87,
    reactions: 45,
    kb_topics: 6,
    split: { text: 1000, media: 200, other: 30 },
    series: [
      { start: "2026-10-13T00:00:00+03:00", count: 0 },
      { start: "2026-10-14T00:00:00+03:00", count: 42 },
    ],
    top_groups: [
      { group_jid: "1@g.us", name: "קבוצת הבית", count: 700 },
      { group_jid: "2@g.us", name: null, count: 300 },
    ],
    top_senders: [
      { sender_jid: "972501234567@s.whatsapp.net", name: null, count: 90 },
      { sender_jid: "972509999999@s.whatsapp.net", name: "Dana", count: 50 },
    ],
    by_hour: Array.from({ length: 24 }, (_, h) => (h === 9 ? 5 : 0)),
    by_weekday: [1, 2, 3, 4, 5, 6, 7],
    ...over,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function Search() {
  return <output data-testid="search">{useLocation().search}</output>;
}

function renderAt(url = "/") {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Dashboard />
      <Search />
    </MemoryRouter>,
  );
}

let visibility: DocumentVisibilityState = "visible";
function setVisibility(v: DocumentVisibilityState) {
  visibility = v;
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

/** Let pending promise callbacks run (fake timers do not block microtasks). */
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

const user = () => userEvent.setup({ delay: null });

/** Two rounds: the mocked request settles, then the state update renders. */
async function loaded() {
  await flush();
  await flush();
}

/** A chart card, found from its heading (ChartCard sections carry no accessible name of their own). */
function chart(title: string) {
  const h = screen.getByRole("heading", { level: 2, name: title });
  return h.closest("section") as HTMLElement;
}

/** The value text shown in a stat tile, found from its label. */
function tile(label: string) {
  const dt = screen.getAllByRole("term").find((t) => t.firstChild?.textContent === label);
  if (!dt) throw new Error(`no tile ${label}`);
  return dt.parentElement as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only the refresh interval and the clock are faked: Testing Library waits on a real setTimeout.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  vi.setSystemTime(NOW);
  mockViewport(1280);
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
  vi.mocked(api.getStats).mockResolvedValue(stats());
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Dashboard request parameters", () => {
  it("requests the last 7 days by default, anchored on now", async () => {
    renderAt();
    await loaded();
    expect(api.getStats).toHaveBeenCalledTimes(1);
    expect(api.getStats).toHaveBeenCalledWith({ from: "2026-10-03T12:00:00.000Z", to: "2026-10-10T12:00:00.000Z" });
  });

  it.each([
    ["24 hours", "?range=24h", { from: "2026-10-09T12:00:00.000Z", to: "2026-10-10T12:00:00.000Z" }],
    ["30 days", "?range=30d", { from: "2026-09-10T12:00:00.000Z", to: "2026-10-10T12:00:00.000Z" }],
    ["90 days", "?range=90d", { from: "2026-07-12T12:00:00.000Z", to: "2026-10-10T12:00:00.000Z" }],
    ["All time", "?range=all", {}],
  ])("%s requests %s and writes it to the URL", async (chip, search, params) => {
    renderAt();
    await loaded();
    await user().click(screen.getByRole("button", { name: chip }));
    await flush();
    expect(api.getStats).toHaveBeenLastCalledWith(params);
    expect(screen.getByTestId("search")).toHaveTextContent(search);
  });

  it("requests a custom range as local whole days, end inclusive", async () => {
    renderAt();
    await loaded();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Custom" }));
    await u.type(screen.getByLabelText("From"), "2026-10-01");
    await u.type(screen.getByLabelText("To"), "2026-10-05");
    await u.click(screen.getByRole("button", { name: "Apply" }));
    await flush();
    expect(api.getStats).toHaveBeenLastCalledWith({
      from: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 9, 5, 23, 59, 59, 999).toISOString(),
    });
    expect(screen.getByTestId("search")).toHaveTextContent("?range=custom&from=2026-10-01&to=2026-10-05");
  });

  it("restores the range from the URL", async () => {
    renderAt("/?range=custom&from=2026-09-01&to=2026-09-30");
    await loaded();
    expect(api.getStats).toHaveBeenCalledWith({
      from: new Date(2026, 8, 1).toISOString(),
      to: new Date(2026, 8, 30, 23, 59, 59, 999).toISOString(),
    });
    expect(screen.getByRole("button", { name: "Custom" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("From")).toHaveValue("2026-09-01");
  });

  it("restores a preset from the URL", async () => {
    renderAt("/?range=all");
    await loaded();
    expect(api.getStats).toHaveBeenCalledWith({});
    expect(screen.getByRole("button", { name: "All time" })).toHaveAttribute("aria-pressed", "true");
  });

  it.each([
    ["reversed", "2026-10-05", "2026-10-01", "The start date must not be after the end date."],
    ["empty", "", "", "Enter a valid start and end date."],
    ["partial", "2026-10-05", "", "Enter a valid start and end date."],
  ])("a %s custom range shows an inline error and fires no request", async (_name, from, to, message) => {
    renderAt();
    await loaded();
    const u = user();
    await u.click(screen.getByRole("button", { name: "Custom" }));
    if (from) await u.type(screen.getByLabelText("From"), from);
    if (to) await u.type(screen.getByLabelText("To"), to);
    await u.click(screen.getByRole("button", { name: "Apply" }));
    await flush();
    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(api.getStats).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("search")).toBeEmptyDOMElement();
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });
});

describe("Dashboard stale responses", () => {
  it("ignores an older response that arrives after a newer one", async () => {
    const first = deferred<Stats>();
    const second = deferred<Stats>();
    vi.mocked(api.getStats).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderAt();
    await user().click(screen.getByRole("button", { name: "30 days" }));
    await act(async () => second.resolve(stats({ messages: 3030 })));
    await loaded();
    expect(screen.getByText("3,030")).toBeInTheDocument();
    await act(async () => first.resolve(stats({ messages: 777 })));
    expect(screen.queryByText("777")).not.toBeInTheDocument();
    expect(screen.getByText("3,030")).toBeInTheDocument();
  });

  it("ignores an older response that arrives before the newer one", async () => {
    const first = deferred<Stats>();
    const second = deferred<Stats>();
    vi.mocked(api.getStats).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderAt();
    await user().click(screen.getByRole("button", { name: "30 days" }));
    await act(async () => first.resolve(stats({ messages: 777 })));
    expect(screen.queryByText("777")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading the dashboard" })).toBeInTheDocument();
    await act(async () => second.resolve(stats({ messages: 3030 })));
    expect(screen.getByText("3,030")).toBeInTheDocument();
  });

  it("ignores an older failure after a newer success", async () => {
    const first = deferred<Stats>();
    vi.mocked(api.getStats).mockReturnValueOnce(first.promise).mockResolvedValueOnce(stats({ messages: 3030 }));
    renderAt();
    await user().click(screen.getByRole("button", { name: "30 days" }));
    await loaded();
    expect(screen.getByText("3,030")).toBeInTheDocument();
    await act(async () => first.reject(new Error("boom")));
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("does not show the previous range's numbers while a new range loads", async () => {
    const next = deferred<Stats>();
    renderAt();
    await loaded();
    vi.mocked(api.getStats).mockReturnValueOnce(next.promise);
    await user().click(screen.getByRole("button", { name: "90 days" }));
    expect(screen.queryByText("1,234")).not.toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading the dashboard" })).toBeInTheDocument();
    await act(async () => next.resolve(stats({ messages: 9090 })));
    expect(screen.getByText("9,090")).toBeInTheDocument();
  });
});

describe("Dashboard auto-refresh", () => {
  it("reloads a relative preset every 60 s with a fresh window", async () => {
    renderAt();
    await loaded();
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(api.getStats).toHaveBeenCalledTimes(2);
    expect(api.getStats).toHaveBeenLastCalledWith({ from: "2026-10-03T12:01:00.000Z", to: "2026-10-10T12:01:00.000Z" });
  });

  it("keeps the old numbers visible while refreshing", async () => {
    renderAt();
    await loaded();
    const next = deferred<Stats>();
    vi.mocked(api.getStats).mockReturnValueOnce(next.promise);
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.queryByRole("status", { name: "Loading the dashboard" })).not.toBeInTheDocument();
    await act(async () => next.resolve(stats({ messages: 1300 })));
    expect(screen.getByText("1,300")).toBeInTheDocument();
  });

  it.each([["/?range=all"], ["/?range=custom&from=2026-10-01&to=2026-10-05"]])("does not auto-reload %s", async (url) => {
    renderAt(url);
    await loaded();
    await act(async () => void vi.advanceTimersByTime(180_000));
    expect(api.getStats).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and catches up once when it is shown", async () => {
    renderAt();
    await loaded();
    setVisibility("hidden");
    await act(async () => void vi.advanceTimersByTime(180_000));
    expect(api.getStats).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(api.getStats).toHaveBeenCalledTimes(2);
    // Showing it again without a missed tick does not reload.
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(api.getStats).toHaveBeenCalledTimes(2);
  });

  it("applies a refresh that resolves after the tab was hidden", async () => {
    renderAt();
    await loaded();
    const next = deferred<Stats>();
    vi.mocked(api.getStats).mockReturnValueOnce(next.promise);
    await act(async () => void vi.advanceTimersByTime(60_000));
    setVisibility("hidden");
    await act(async () => next.resolve(stats({ messages: 1500 })));
    expect(screen.getByText("1,500")).toBeInTheDocument();
  });

  it("stops refreshing after switching to All time", async () => {
    renderAt();
    await loaded();
    await user().click(screen.getByRole("button", { name: "All time" }));
    await flush();
    expect(api.getStats).toHaveBeenCalledTimes(2);
    await act(async () => void vi.advanceTimersByTime(180_000));
    expect(api.getStats).toHaveBeenCalledTimes(2);
  });
});

describe("Dashboard content", () => {
  it("shows every tile with its value and label", async () => {
    renderAt();
    await loaded();
    expect(tile("Groups")).toHaveTextContent("12");
    expect(tile("Groups")).toHaveTextContent("3 managed");
    expect(tile("Groups")).toHaveTextContent("All time");
    expect(within(tile("Chats")).getByRole("definition")).toHaveTextContent("15");
    expect(within(tile("Messages")).getByRole("definition")).toHaveTextContent("1,234");
    expect(within(tile("Active senders")).getByRole("definition")).toHaveTextContent("87");
    expect(within(tile("Reactions")).getByRole("definition")).toHaveTextContent("45");
    expect(within(tile("Knowledge-base topics")).getByRole("definition")).toHaveTextContent("6");
  });

  it("shows the server time zone", async () => {
    renderAt();
    await loaded();
    expect(screen.getByText("Times in Asia/Jerusalem")).toBeInTheDocument();
  });

  it("labels day buckets in the server time zone", async () => {
    renderAt();
    await loaded();
    const series = chart("Messages over time");
    expect(within(series).getByRole("img", { name: "Wed 14 Oct: 42 messages" })).toBeInTheDocument();
    expect(within(series).getByRole("img", { name: "Tue 13 Oct: 0 messages" })).toBeInTheDocument();
  });

  it.each([
    ["hour", "2026-10-14T09:00:00+03:00", "Wed 14 Oct, 09:00: 3 messages"],
    ["week", "2026-10-12T00:00:00+03:00", "Week of Mon 12 Oct: 3 messages"],
    ["month", "2026-10-01T00:00:00+03:00", "Oct 2026: 3 messages"],
  ] as const)("labels %s buckets", async (bucket, start, label) => {
    vi.mocked(api.getStats).mockResolvedValue(stats({ bucket, series: [{ start, count: 3 }] }));
    renderAt();
    await loaded();
    expect(screen.getByRole("img", { name: label })).toBeInTheDocument();
  });

  it("says 1 message, not 1 messages", async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats({ series: [{ start: "2026-10-14T00:00:00+03:00", count: 1 }] }));
    renderAt();
    await loaded();
    expect(screen.getByRole("img", { name: "Wed 14 Oct: 1 message" })).toBeInTheDocument();
  });

  it("shows hour-of-day and weekday activity, Sunday first", async () => {
    renderAt();
    await loaded();
    const hours = chart("Activity by hour of day");
    expect(within(hours).getAllByRole("img")).toHaveLength(24);
    expect(within(hours).getByRole("img", { name: "09:00–10:00: 5 messages" })).toBeInTheDocument();
    const days = chart("Activity by weekday");
    const bars = within(days).getAllByRole("img");
    expect(bars.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Sunday: 1 message",
      "Monday: 2 messages",
      "Tuesday: 3 messages",
      "Wednesday: 4 messages",
      "Thursday: 5 messages",
      "Friday: 6 messages",
      "Saturday: 7 messages",
    ]);
  });

  it("lists top groups and senders, falling back to the JID user part", async () => {
    renderAt();
    await loaded();
    const groups = chart("Top 5 groups");
    const hebrew = within(groups).getByText("קבוצת הבית");
    expect(hebrew.tagName).toBe("BDI");
    expect(hebrew).toHaveAttribute("dir", "auto");
    expect(within(groups).getByText("700")).toBeInTheDocument();
    expect(within(groups).getByText("2")).toBeInTheDocument();
    const senders = chart("Top senders");
    expect(within(senders).getByText("972501234567")).toBeInTheDocument();
    expect(within(senders).queryByText(/@s\.whatsapp\.net/)).not.toBeInTheDocument();
    expect(within(senders).getByText("Dana")).toBeInTheDocument();
  });

  it("renders names as text, never as HTML", async () => {
    vi.mocked(api.getStats).mockResolvedValue(
      stats({ top_senders: [{ sender_jid: "1@s.whatsapp.net", name: "<img src=x onerror=alert(1)>", count: 3 }] }),
    );
    const { container } = renderAt();
    await loaded();
    screen.getByText("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("splits text and media in the donut with chart colours", async () => {
    renderAt();
    await loaded();
    const card = chart("Text vs media");
    expect(within(card).getByTestId("donut-total")).toHaveTextContent("1,230");
    expect(within(card).getByText("Text")).toBeInTheDocument();
    expect(within(card).getByText("Media")).toBeInTheDocument();
    expect(within(card).getByText("Other")).toBeInTheDocument();
    const arcs = card.querySelectorAll("[data-arc]");
    expect([...arcs].map((a) => a.getAttribute("stroke"))).toEqual(["var(--chart-1)", "var(--chart-2)", "var(--chart-3)"]);
  });

  it("leaves Other out of the donut when there is none", async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats({ split: { text: 10, media: 5, other: 0 } }));
    renderAt();
    await loaded();
    const card = chart("Text vs media");
    expect(within(card).queryByText("Other")).not.toBeInTheDocument();
  });

  it("shows the same numbers as a table", async () => {
    renderAt();
    await loaded();
    const card = chart("Messages over time");
    await user().click(within(card).getByRole("button", { name: "Show as table" }));
    const table = within(card).getByRole("table");
    expect(within(table).getByRole("rowheader", { name: "Wed 14 Oct" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "42" })).toBeInTheDocument();
  });
});

describe("Dashboard states", () => {
  it("shows skeletons while the first load runs", async () => {
    vi.mocked(api.getStats).mockReturnValue(new Promise(() => {}));
    renderAt();
    expect(screen.getByRole("status", { name: "Loading the dashboard" })).toBeInTheDocument();
    expect(screen.queryByRole("term")).not.toBeInTheDocument();
  });

  it("shows an inline error with Retry, and recovers", async () => {
    vi.mocked(api.getStats).mockRejectedValueOnce(new Error("Server unavailable"));
    renderAt();
    await loaded();
    expect(screen.getByRole("alert")).toHaveTextContent("Server unavailable");
    expect(toast.error).not.toHaveBeenCalled();
    await user().click(screen.getByRole("button", { name: "Retry" }));
    await loaded();
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("toasts a failed refresh and keeps the numbers", async () => {
    renderAt();
    await loaded();
    vi.mocked(api.getStats).mockRejectedValueOnce(new Error("Server unavailable"));
    await act(async () => void vi.advanceTimersByTime(60_000));
    expect(toast.error).toHaveBeenCalledWith("Server unavailable");
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not show an error for 401 (the session handler redirects)", async () => {
    vi.mocked(api.getStats).mockRejectedValueOnce(new ApiError(401, "Not authenticated"));
    renderAt();
    await flush();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the charts with an empty state when the range has no messages; tiles show zeros", async () => {
    vi.mocked(api.getStats).mockResolvedValue(
      stats({
        messages: 0,
        chats: 0,
        active_senders: 0,
        reactions: 0,
        kb_topics: 0,
        series: [],
        top_groups: [],
        top_senders: [],
        by_hour: Array(24).fill(0),
        by_weekday: Array(7).fill(0),
        split: { text: 0, media: 0, other: 0 },
      }),
    );
    renderAt();
    await loaded();
    expect(screen.getByText("No messages in this range")).toBeInTheDocument();
    expect(within(tile("Messages")).getByRole("definition")).toHaveTextContent("0");
    expect(tile("Groups")).toHaveTextContent("12");
    expect(screen.queryByRole("heading", { name: "Messages over time" })).not.toBeInTheDocument();
  });

  it("notes when bot messages could not be excluded", async () => {
    vi.mocked(api.getStats).mockResolvedValue(stats({ bot_excluded: false }));
    renderAt();
    await loaded();
    expect(screen.getByText("Bot messages could not be identified and are included")).toBeInTheDocument();
  });

  it("has no bot note when the bot was excluded", async () => {
    renderAt();
    await loaded();
    expect(screen.queryByText(/could not be identified/)).not.toBeInTheDocument();
  });
});

describe("Dashboard structure", () => {
  it("sets the page title and heading", async () => {
    renderAt();
    await loaded();
    expect(document.title).toBe("Dashboard · WhatsApp Bot Admin");
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  });

  it("titles each chart with a heading and labels the summary region", async () => {
    renderAt();
    await loaded();
    expect(screen.getByRole("region", { name: "Summary" })).toBeInTheDocument();
    const h2 = screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent);
    expect(h2).toEqual([
      "Summary",
      "Messages over time",
      "Top 5 groups",
      "Top senders",
      "Activity by hour of day",
      "Activity by weekday",
      "Text vs media",
    ]);
  });
});
