import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Groups from "./Groups";
import { api } from "../api";
import type { Group } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listGroups: vi.fn(), patchGroup: vi.fn() } };
});

const base: Group = {
  group_jid: "1@g.us", group_name: "WA name", display_name: null, group_topic: "topic",
  owner_jid: "9725@s.whatsapp.net", managed: false, notify_on_spam: false,
  community_keys: [], last_summary_sync: "2026-01-02T03:04:05", last_ingest: "2026-01-02T03:04:05",
  message_count: 12,
};

function setup(groups: Group[]) {
  vi.mocked(api.listGroups).mockResolvedValue({ items: groups, total: groups.length });
  vi.mocked(api.patchGroup).mockImplementation(async (jid, patch) => ({ ...groups.find((g) => g.group_jid === jid)!, ...patch } as Group));
  return render(<Groups />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, "confirm").mockReturnValue(true);
});

describe("Groups page", () => {
  it("lists groups showing display name first and the real WhatsApp name", async () => {
    setup([{ ...base, display_name: "My alias" }]);
    expect(await screen.findByText("My alias")).toBeInTheDocument();
    expect(screen.getByText(/WA name/)).toBeInTheDocument();
  });

  it("asks for confirmation before enabling managed and shows last_summary_sync", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("checkbox", { name: /respond.*1@g\.us/i }));
    expect(window.confirm).toHaveBeenCalledTimes(1);
    const msg = vi.mocked(window.confirm).mock.calls[0][0];
    expect(msg).toContain("WA name");
    expect(msg).toContain(new Date(base.last_summary_sync).toLocaleString());
    await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { managed: true }));
  });

  it("does not enable managed when the confirmation is declined", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    setup([base]);
    await userEvent.click(await screen.findByRole("checkbox", { name: /respond.*1@g\.us/i }));
    expect(api.patchGroup).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /respond.*1@g\.us/i })).not.toBeChecked();
  });

  it("disabling managed and toggling the spam notice do not ask for confirmation", async () => {
    setup([{ ...base, managed: true }]);
    await userEvent.click(await screen.findByRole("checkbox", { name: /respond.*1@g\.us/i }));
    await userEvent.click(screen.getByRole("checkbox", { name: /spam.*1@g\.us/i }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { managed: false });
    expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { notify_on_spam: true });
  });

  it("edits display name and community keys and sends only those fields", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Display name"), "Friends");
    await userEvent.type(within(dialog).getByLabelText("Community keys"), "family{Enter}");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { display_name: "Friends", community_keys: ["family"] }),
    );
  });

  it("shows an error banner and keeps the old value when saving fails", async () => {
    setup([base]);
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(await screen.findByRole("checkbox", { name: /spam.*1@g\.us/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    expect(screen.getByRole("checkbox", { name: /spam.*1@g\.us/i })).not.toBeChecked();
  });

  it("failed list save shows the alert, reloads, and reflects server state", async () => {
    setup([base]);
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("nope"));
    const box = await screen.findByRole("checkbox", { name: /respond.*1@g\.us/i });
    const before = vi.mocked(api.listGroups).mock.calls.length;
    await userEvent.click(box);
    expect(await screen.findByRole("alert")).toHaveTextContent("nope");
    await waitFor(() => expect(vi.mocked(api.listGroups).mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByRole("checkbox", { name: /respond.*1@g\.us/i })).not.toBeChecked();
  });

  it("keeps the dialog open with edits and an inner alert on failure, closes on retry success", async () => {
    setup([base]);
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("422 bad"));
    await userEvent.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Display name"), "Friends");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("422 bad");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Display name")).toHaveValue("Friends");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(api.patchGroup).toHaveBeenCalledTimes(2);
  });

  it("commits a pending tag on Save without Enter", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText("Community keys"), "pending");
    await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { community_keys: ["pending"] }));
  });

  it("shows the owner read-only in the dialog", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    expect(within(screen.getByRole("dialog")).getByText(/9725@s\.whatsapp\.net/)).toBeInTheDocument();
  });

  it("paginates with Next/Previous and resets the offset when sort changes", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ ...base, group_jid: `${i}@g.us` }));
    vi.mocked(api.listGroups).mockResolvedValue({ items: many, total: 120 });
    render(<Groups />);
    const prev = await screen.findByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toBeDisabled();
    await userEvent.click(next);
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
    await userEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 100 })));
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 })));
    await userEvent.selectOptions(screen.getByLabelText("Sort"), "-message_count");
    await waitFor(() =>
      expect(api.listGroups).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0, sort: "-message_count" })),
    );
  });

  it("shows an empty state", async () => {
    setup([]);
    expect(await screen.findByText("No groups match.")).toBeInTheDocument();
  });
});
