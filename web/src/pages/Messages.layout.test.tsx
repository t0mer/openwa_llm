import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Messages from "./Messages";
import { ApiError, api } from "../api";
import { mockViewport } from "../hooks/mockViewport";
import type { MessageItem } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listMessages: vi.fn(), listGroups: vi.fn() } };
});
vi.mock("../alerts");
import { toast } from "../alerts";

const msg = (id: string, text: string, over: Partial<MessageItem> = {}): MessageItem => ({
  message_id: id, timestamp: "2026-03-01T10:00:00Z", text, sender_jid: "1@s.whatsapp.net",
  sender_name: "דנה", group_jid: "1@g.us", chat_jid: "1@g.us", reply_to_id: "x",
  reaction_count: 3, has_media: true, ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listGroups).mockResolvedValue({ items: [{ group_jid: "1@g.us", group_name: "Alpha", display_name: null } as never], total: 1 });
  vi.mocked(api.listMessages).mockResolvedValue({ items: [msg("m1", "שלום עולם"), msg("m2", "plain", { reply_to_id: null, has_media: false, reaction_count: 0, sender_name: null })], next_cursor: "CUR" });
});

describe("Messages rows (desktop)", () => {
  beforeEach(() => void mockViewport(1024));

  it("shows reply/media badges, reaction counts and auto-direction text", async () => {
    render(<Messages />);
    const table = await screen.findByRole("table", { name: "Messages" });
    const rows = within(table).getAllByRole("row");
    const rich = rows.find((r) => within(r).queryByText("שלום עולם"))!;
    expect(within(rich).getByText("reply")).toBeInTheDocument();
    expect(within(rich).getByText("media")).toBeInTheDocument();
    expect(within(rich).getByText("3")).toBeInTheDocument();
    expect(within(rich).getByText("שלום עולם")).toHaveAttribute("dir", "auto");
    expect(within(rich).getByText("דנה").tagName).toBe("BDI");
    const plain = rows.find((r) => within(r).queryByText("plain"))!;
    expect(within(plain).queryByText("reply")).not.toBeInTheDocument();
    expect(within(plain).getAllByText("1@s.whatsapp.net").length).toBeGreaterThan(0);
  });

  it("labels every filter with a visible label", async () => {
    render(<Messages />);
    await screen.findByRole("table");
    for (const l of ["Search text", "Group", "Sender JID", "From date", "To date"]) {
      expect(screen.getAllByLabelText(l)).toHaveLength(1);
    }
  });
});

describe("Messages at phone width", () => {
  beforeEach(() => void mockViewport(390));

  it("renders cards with badges, reactions and the sender JID, no table", async () => {
    render(<Messages />);
    const list = await screen.findByRole("list", { name: "Messages" });
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const [first] = within(list).getAllByRole("listitem");
    expect(within(first).getByText("reply")).toBeInTheDocument();
    expect(within(first).getByText("media")).toBeInTheDocument();
    expect(first).toHaveTextContent("Reactions: 3");
    expect(within(first).getByText("שלום עולם")).toHaveAttribute("dir", "auto");
    expect(within(first).getByText("דנה").tagName).toBe("BDI");
    expect(within(first).getByText("1@s.whatsapp.net").tagName).toBe("BDI");
    expect(within(list).getAllByRole("listitem")[1]).not.toHaveTextContent("Reactions");
  });

  it("gives Load older and Apply a 44px target", async () => {
    render(<Messages />);
    await screen.findByRole("list", { name: "Messages" });
    expect(screen.getByRole("button", { name: "Load older" })).toHaveClass("min-h-11");
    expect(screen.getByRole("button", { name: "Apply" })).toHaveClass("min-h-11");
    expect(screen.getByLabelText("Search text")).toHaveClass("min-h-11");
  });

  it("shows skeletons while loading, an announced empty state, and a toast (no inline error) when Load older fails", async () => {
    vi.mocked(api.listMessages).mockReturnValueOnce(new Promise(() => {}));
    const { unmount } = render(<Messages />);
    expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    unmount();
    vi.mocked(api.listMessages).mockResolvedValueOnce({ items: [], next_cursor: null });
    const second = render(<Messages />);
    expect(await screen.findByText("No messages match.")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("No messages match.");
    second.unmount();
    vi.mocked(api.listMessages).mockResolvedValueOnce({ items: [msg("m1", "kept")], next_cursor: "CUR" }).mockRejectedValueOnce(new ApiError(500, "boom"));
    render(<Messages />);
    await screen.findByText("kept");
    await userEvent.click(screen.getByRole("button", { name: "Load older" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("kept")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load older" })).toBeEnabled();
  });

  it("validates the date range with the unchanged message", async () => {
    render(<Messages />);
    await screen.findByRole("list", { name: "Messages" });
    fireEvent.change(screen.getByLabelText("From date"), { target: { value: "2026-03-10" } });
    fireEvent.change(screen.getByLabelText("To date"), { target: { value: "2026-03-01" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(toast.error).toHaveBeenCalledWith("To date must not be before From date.");
    expect(api.listMessages).toHaveBeenCalledTimes(1);
  });

  it("shows a failed first page inline only, with no toast and no empty state", async () => {
    vi.mocked(api.listMessages).mockReset().mockRejectedValue(new ApiError(500, "down"));
    render(<Messages />);
    expect(await screen.findByRole("alert")).toHaveTextContent("down");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.queryByText("No messages match.")).not.toBeInTheDocument();
  });
});

describe("Messages across a viewport resize", () => {
  it("swaps table and cards without duplicating controls or losing rows and drafts", async () => {
    const vp = mockViewport(1024);
    vi.mocked(api.listMessages).mockResolvedValue({ items: [msg("m1", "hello")], next_cursor: "CUR" });
    render(<Messages />);
    await screen.findByRole("table", { name: "Messages" });
    fireEvent.change(screen.getByLabelText("Search text"), { target: { value: "draft" } });
    for (const [width, kind] of [[600, "list"], [1024, "table"]] as const) {
      vp.setWidth(width);
      expect(await screen.findByRole(kind, { name: "Messages" })).toBeInTheDocument();
      expect(screen.queryByRole(kind === "list" ? "table" : "list", { name: "Messages" })).not.toBeInTheDocument();
      expect(screen.getAllByText("hello")).toHaveLength(1);
      expect(screen.getAllByRole("button", { name: "Load older" })).toHaveLength(1);
      expect(screen.getAllByLabelText("Search text")).toHaveLength(1);
      expect(screen.getByLabelText("Search text")).toHaveValue("draft");
    }
    expect(api.listMessages).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByRole("button", { name: "Load older" })).toBeEnabled());
  });
});
