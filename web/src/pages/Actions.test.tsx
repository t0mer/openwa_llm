import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Actions from "./Actions";
import { ApiError, api } from "../api";
import type { Actions as ActionsT } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { getActions: vi.fn(), runAction: vi.fn() } };
});

vi.mock("../alerts");
import { confirm, errorDialog, toast } from "../alerts";

const idle = { state: "idle", started_at: null, finished_at: null, error: null } as const;
const statuses = (over: Partial<ActionsT> = {}): ActionsT => ({ summarize: idle, load_kb: idle, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirm).mockResolvedValue(true);
  vi.mocked(api.getActions).mockResolvedValue(statuses());
  vi.mocked(api.runAction).mockResolvedValue({ job_id: "j1" });
});

describe("Actions page", () => {
  it("runs the summary job after confirmation and refreshes the status", async () => {
    render(<Actions />);
    await userEvent.click(await screen.findByRole("button", { name: "Run summaries now" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ title: "Group summaries", text: expect.stringContaining("Generate and send summaries") }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    await waitFor(() => expect(api.runAction).toHaveBeenCalledWith("summarize"));
    expect(api.runAction).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.getActions).toHaveBeenCalledTimes(2));
  });

  it("runs the knowledge-base job", async () => {
    render(<Actions />);
    await userEvent.click(await screen.findByRole("button", { name: "Load knowledge base topics" }));
    await waitFor(() => expect(api.runAction).toHaveBeenCalledWith("load_kb"));
    expect(api.runAction).toHaveBeenCalledTimes(1);
  });

  it("blocks a second start while the first request is in flight", async () => {
    let release: (v: { job_id: string }) => void = () => {};
    vi.mocked(api.runAction).mockReturnValueOnce(new Promise((r) => { release = r; }));
    render(<Actions />);
    const btn = await screen.findByRole("button", { name: "Run summaries now" });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    await userEvent.click(btn);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.runAction).toHaveBeenCalledTimes(1);
    release({ job_id: "j1" });
    await waitFor(() => expect(btn).toBeEnabled());
  });

  it("polls the status every 5 seconds", async () => {
    vi.useFakeTimers();
    try {
      render(<Actions />);
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(api.getActions).toHaveBeenCalledTimes(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
      expect(api.getActions).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does nothing when the confirmation is declined", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    render(<Actions />);
    await userEvent.click(await screen.findByRole("button", { name: "Run summaries now" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.runAction).not.toHaveBeenCalled();
  });

  it("disables the button and shows state while a job is running", async () => {
    vi.mocked(api.getActions).mockResolvedValue(
      statuses({ summarize: { state: "running", started_at: "2026-01-01T00:00:00Z", finished_at: null, error: null } }),
    );
    render(<Actions />);
    expect(await screen.findByRole("button", { name: "Run summaries now" })).toBeDisabled();
    expect(screen.getByText("Running")).toBeInTheDocument();
  });

  it("shows a failed job's error and handles a 409 from the server", async () => {
    vi.mocked(api.getActions).mockResolvedValue(
      statuses({ load_kb: { state: "failed", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:01:00Z", error: "RuntimeError: boom" } }),
    );
    vi.mocked(api.runAction).mockRejectedValueOnce(new ApiError(409, "summarize is already running"));
    render(<Actions />);
    expect(await screen.findByText("RuntimeError: boom")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run summaries now" }));
    await waitFor(() => expect(errorDialog).toHaveBeenCalledWith(expect.any(String), "summarize is already running"));
    expect(screen.getByRole("alert")).toHaveTextContent("RuntimeError: boom");
    expect(api.runAction).toHaveBeenCalledTimes(1);
    expect(api.runAction).toHaveBeenCalledWith("summarize");
    await waitFor(() => expect(api.getActions).toHaveBeenCalledTimes(2));
  });

  it("reports a failed start in an error dialog and no success toast", async () => {
    vi.mocked(api.runAction).mockRejectedValueOnce(new ApiError(500, "first failure"));
    render(<Actions />);
    await userEvent.click(await screen.findByRole("button", { name: "Run summaries now" }));
    await waitFor(() => expect(errorDialog).toHaveBeenCalledWith(expect.any(String), "first failure"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("shows load errors as a toast", async () => {
    vi.mocked(api.getActions).mockRejectedValue(new ApiError(500, "server down"));
    render(<Actions />);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("server down"));
  });
});
