import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Actions from "./Actions";
import { ApiError, api } from "../api";
import { mockViewport } from "../hooks/mockViewport";
import type { Actions as ActionsT } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { getActions: vi.fn(), runAction: vi.fn() } };
});
vi.mock("../alerts");

const idle = { state: "idle", started_at: null, finished_at: null, error: null } as const;
const done = {
  state: "succeeded", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:01:00Z", error: null,
  summary: { managed_groups: 3, message: null },
  results: [
    { group_name: "קבוצה", group_jid: "1@g.us", status: "sent", reason: null, message_count: 20, required: 15 },
    { group_name: "Beta", group_jid: "2@g.us", status: "skipped", reason: "not_enough_messages", message_count: 9, required: 15 },
    { group_name: "Gamma", group_jid: "3@g.us", status: "failed", reason: "send_error", message_count: 30, required: 15 },
  ],
} as const;
const set = (over: Partial<ActionsT> = {}): ActionsT => ({ summarize: idle, load_kb: idle, ...over }) as ActionsT;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.getActions).mockResolvedValue(set());
});

describe.each([390, 1024])("Bot actions at %i", (width) => {
  beforeEach(() => void mockViewport(width));

  it("renders both cards once with a titled section and one Run button each", async () => {
    render(<Actions />);
    expect(await screen.findByRole("heading", { name: "Group summaries" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Knowledge base" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Run summaries now" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Load knowledge base topics" })).toHaveLength(1);
    expect(screen.getAllByText("Idle")).toHaveLength(2);
    expect(screen.getAllByText(/^Started:/)).toHaveLength(2);
  });

  it("maps each state to a badge word", async () => {
    vi.mocked(api.getActions).mockResolvedValue(set({ summarize: { ...idle, state: "running" }, load_kb: { ...idle, state: "failed", error: "boom" } }));
    render(<Actions />);
    expect(await screen.findByText("Running")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
  });

  it("lists per-group results as rows with sent/skipped/failed badges and friendly reasons", async () => {
    vi.mocked(api.getActions).mockResolvedValue(set({ summarize: { ...done, results: [...done.results] } }));
    render(<Actions />);
    const list = await screen.findByRole("list", { name: "Summary results per group" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).getByText("sent")).toBeInTheDocument();
    expect(within(rows[0]).getByText("קבוצה").tagName).toBe("BDI");
    expect(within(rows[1]).getByText("skipped")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Skipped: 9 of 15 messages needed")).toBeInTheDocument();
    expect(within(rows[2]).getByText("failed")).toBeInTheDocument();
    expect(within(rows[2]).getByText("Failed: send error")).toBeInTheDocument();
  });

  it("announces a failed job's error as an alert", async () => {
    vi.mocked(api.getActions).mockResolvedValue(set({ load_kb: { ...idle, state: "failed", error: "RuntimeError: boom" } }));
    render(<Actions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("RuntimeError: boom");
  });

  it("shows a skeleton while loading and an inline load error", async () => {
    vi.mocked(api.getActions).mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<Actions />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    unmount();
    vi.mocked(api.getActions).mockRejectedValue(new ApiError(500, "server down"));
    render(<Actions />);
    expect(await screen.findByRole("alert")).toHaveTextContent("server down");
  });
});

describe("Bot actions touch targets", () => {
  it("makes Run buttons 44px tall and full width on phones", async () => {
    mockViewport(390);
    render(<Actions />);
    const run = await screen.findByRole("button", { name: "Run summaries now" });
    expect(run).toHaveClass("min-h-11", "w-full");
  });
});
