import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Messages from "./Messages";
import { ApiError, api } from "../api";
import type { MessageItem } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listMessages: vi.fn(), listGroups: vi.fn() } };
});

vi.mock("../alerts");
import { toast } from "../alerts";

const msg = (id: string, text: string): MessageItem => ({
  message_id: id, timestamp: "2026-03-01T10:00:00Z", text, sender_jid: "1@s.whatsapp.net",
  sender_name: "Dana", group_jid: "1@g.us", chat_jid: "1@g.us", reply_to_id: null,
  reaction_count: 2, has_media: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listGroups).mockResolvedValue({
    items: [{ group_jid: "1@g.us", group_name: "Alpha", display_name: null } as never],
    total: 1,
  });
});

describe("Messages page", () => {
  it("shows messages and appends older ones with the cursor", async () => {
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce({ items: [msg("m2", "second")], next_cursor: "CUR" })
      .mockResolvedValueOnce({ items: [msg("m1", "first")], next_cursor: null });
    render(<Messages />);
    expect(await screen.findByText("second")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(api.listMessages).toHaveBeenNthCalledWith(1, expect.objectContaining({ limit: 50, before: undefined }));
    expect(api.listMessages).toHaveBeenNthCalledWith(2, expect.objectContaining({ limit: 50, before: "CUR" }));
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("applies filters and restarts from the newest page", async () => {
    vi.mocked(api.listMessages).mockResolvedValue({ items: [msg("m1", "hello")], next_cursor: null });
    render(<Messages />);
    await screen.findByText("hello");
    await userEvent.type(screen.getByLabelText("Search text"), "deploy");
    await userEvent.selectOptions(await screen.findByLabelText("Group"), "1@g.us");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() =>
      expect(api.listMessages).toHaveBeenLastCalledWith(expect.objectContaining({ q: "deploy", group_jid: "1@g.us", limit: 50, before: undefined })),
    );
  });

  it("shows an empty state and errors", async () => {
    vi.mocked(api.listMessages).mockResolvedValueOnce({ items: [], next_cursor: null });
    render(<Messages />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(await screen.findByText("No messages match.")).toBeInTheDocument();
    expect(screen.queryByText("Loading…")).not.toBeInTheDocument();
  });

  it("does not append a page twice on a double click", async () => {
    let resolveOlder!: (v: never) => void;
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce({ items: [msg("m2", "second")], next_cursor: "CUR" })
      .mockReturnValueOnce(new Promise((r) => { resolveOlder = r as never; }));
    render(<Messages />);
    await screen.findByText("second");
    const btn = screen.getByRole("button", { name: "Load older" });
    await userEvent.click(btn);
    await userEvent.click(btn);
    expect(api.listMessages).toHaveBeenCalledTimes(2);
    expect(btn).toBeDisabled();
    resolveOlder({ items: [msg("m1", "first")], next_cursor: null } as never);
    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(screen.getAllByText("first")).toHaveLength(1);
  });

  it("ignores a slow earlier response that arrives after a newer one", async () => {
    let resolveSlow!: (v: never) => void;
    vi.mocked(api.listMessages)
      .mockReturnValueOnce(new Promise((r) => { resolveSlow = r as never; }))
      .mockResolvedValueOnce({ items: [msg("n1", "newer")], next_cursor: null });
    render(<Messages />);
    await userEvent.type(screen.getByLabelText("Search text"), "x");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("newer")).toBeInTheDocument();
    resolveSlow({ items: [msg("o1", "stale")], next_cursor: "OLD" } as never);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByText("stale")).not.toBeInTheDocument();
    expect(screen.getByText("newer")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Load older" })).not.toBeInTheDocument();
  });

  it("keeps rows and shows the error when Load older fails, then retries", async () => {
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce({ items: [msg("m2", "second")], next_cursor: "CUR" })
      .mockRejectedValueOnce(new ApiError(500, "boom"))
      .mockResolvedValueOnce({ items: [msg("m1", "first")], next_cursor: null });
    render(<Messages />);
    await screen.findByText("second");
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(screen.getByText("second")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    expect(await screen.findByText("first")).toBeInTheDocument();
    expect(api.listMessages).toHaveBeenLastCalledWith(expect.objectContaining({ before: "CUR" }));
  });

  it("shows the server's 422 for an out-of-range date and keeps the rows", async () => {
    vi.mocked(api.listMessages)
      .mockResolvedValueOnce({ items: [msg("m1", "hello")], next_cursor: "CUR" })
      .mockRejectedValueOnce(new ApiError(422, "from out of range"));
    render(<Messages />);
    await screen.findByText("hello");
    await userEvent.type(screen.getByLabelText("From date"), "1900-01-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("from out of range"));
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(api.listMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ from: new Date("1900-01-01T00:00:00").toISOString(), before: undefined }),
    );
  });

  it("does not send when To date is before From date", async () => {
    vi.mocked(api.listMessages).mockResolvedValue({ items: [msg("m1", "hello")], next_cursor: null });
    render(<Messages />);
    await screen.findByText("hello");
    await userEvent.type(screen.getByLabelText("From date"), "2026-03-10");
    await userEvent.type(screen.getByLabelText("To date"), "2026-03-01");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("To date must not be before From date."));
    expect(api.listMessages).toHaveBeenCalledTimes(1);
  });

  it("still works when the groups request fails", async () => {
    vi.mocked(api.listGroups).mockRejectedValueOnce(new Error("nope"));
    vi.mocked(api.listMessages).mockResolvedValueOnce({ items: [msg("m1", "hello")], next_cursor: null });
    render(<Messages />);
    expect(await screen.findByText("hello")).toBeInTheDocument();
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(api.listGroups).toHaveBeenCalledTimes(1);
  });
});
