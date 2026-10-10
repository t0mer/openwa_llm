import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Dashboard from "./Dashboard";
import { api } from "../api";
import { mockViewport } from "../hooks/mockViewport";
import type { Stats } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { getStats: vi.fn() } };
});
vi.mock("../alerts");

const STATS: Stats = {
  from: "2026-10-03T12:00:00Z",
  to: "2026-10-10T12:00:00Z",
  timezone: "Asia/Jerusalem",
  bucket: "day",
  bot_excluded: true,
  groups: { total: 2, managed: 1 },
  chats: 3,
  messages: 10,
  active_senders: 4,
  reactions: 1,
  kb_topics: 0,
  split: { text: 8, media: 2, other: 0 },
  series: [{ start: "2026-10-14T00:00:00+03:00", count: 10 }],
  top_groups: [{ group_jid: "1@g.us", name: "Alpha", count: 10 }],
  top_senders: [{ sender_jid: "1@s.whatsapp.net", name: "Dana", count: 10 }],
  by_hour: Array(24).fill(0),
  by_weekday: [0, 0, 0, 10, 0, 0, 0],
};

async function renderLoaded() {
  render(
    <MemoryRouter>
      <Dashboard />
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const grid = () => screen.getByTestId("chart-grid");
const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section")!;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getStats).mockResolvedValue(STATS);
});

describe("Dashboard layout", () => {
  it("stacks the charts in one column on a phone", async () => {
    mockViewport(390);
    await renderLoaded();
    expect(grid()).toHaveClass("grid-cols-1");
    expect(grid()).not.toHaveClass("grid-cols-2");
    expect(card("Messages over time")).not.toHaveClass("col-span-2");
  });

  it("uses two columns from lg, the time series spanning both", async () => {
    mockViewport(1280);
    await renderLoaded();
    expect(grid()).toHaveClass("grid-cols-2");
    expect(card("Messages over time")).toHaveClass("col-span-2");
    expect(card("Top 5 groups")).not.toHaveClass("col-span-2");
  });

  it("follows a resize across the lg breakpoint", async () => {
    const vp = mockViewport(1280);
    await renderLoaded();
    expect(grid()).toHaveClass("grid-cols-2");
    vp.setWidth(800);
    expect(grid()).toHaveClass("grid-cols-1");
    vp.setWidth(1024);
    expect(grid()).toHaveClass("grid-cols-2");
  });

  it("keeps the stat grid two-up on phones, widening with Tailwind breakpoints", async () => {
    mockViewport(390);
    await renderLoaded();
    const dl = screen.getByRole("region", { name: "Summary" }).querySelector("dl")!;
    expect(dl).toHaveClass("grid", "grid-cols-2", "sm:grid-cols-3", "lg:grid-cols-4", "divide-x", "divide-y", "rounded-md", "border");
  });

  it("puts the filter beneath the page heading", async () => {
    mockViewport(390);
    await renderLoaded();
    const h1 = screen.getByRole("heading", { level: 1, name: "Dashboard" });
    const filter = screen.getByRole("group", { name: "Date range" });
    expect(h1.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filter.compareDocumentPosition(grid()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
