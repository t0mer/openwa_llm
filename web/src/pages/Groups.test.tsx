import { StrictMode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Groups from "./Groups";
import { api } from "../api";
import type { Group } from "../types";
import { mockViewport } from "../hooks/mockViewport";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listGroups: vi.fn(), patchGroup: vi.fn() } };
});

vi.mock("../alerts");
import { confirm, toast } from "../alerts";

const base: Group = {
  group_jid: "1@g.us", group_name: "WA name", display_name: null, group_topic: "topic",
  owner_jid: "9725@s.whatsapp.net", managed: false, notify_on_spam: false, summary_language: null,
  community_keys: [], last_summary_sync: "2026-01-02T03:04:05", last_ingest: "2026-01-02T03:04:05",
  message_count: 12, schedule_count: 0,
};

function setup(groups: Group[]) {
  vi.mocked(api.listGroups).mockResolvedValue({ items: groups, total: groups.length });
  vi.mocked(api.patchGroup).mockImplementation(async (jid, patch) => ({ ...groups.find((g) => g.group_jid === jid)!, ...patch } as Group));
  return render(<Groups />);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockViewport(1280);
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("Groups page", () => {
  it("lists groups showing display name first and the real WhatsApp name", async () => {
    setup([{ ...base, display_name: "My alias" }]);
    expect(await screen.findByText("My alias")).toBeInTheDocument();
    expect(screen.getByText(/WA name/)).toBeInTheDocument();
  });

  it("asks for confirmation before enabling managed and shows last_summary_sync", async () => {
    setup([base]);
    await userEvent.click(await screen.findByRole("switch", { name: /respond.*1@g\.us/i }));
    expect(confirm).toHaveBeenCalledTimes(1);
    const opts = vi.mocked(confirm).mock.calls[0][0] as { title: string; text: string };
    expect(opts.title).toContain("WA name");
    expect(opts.text).toContain(new Date(base.last_summary_sync).toLocaleString());
    await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { managed: true }));
  });

  it("does not enable managed when the confirmation is declined", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    setup([base]);
    await userEvent.click(await screen.findByRole("switch", { name: /respond.*1@g\.us/i }));
    expect(api.patchGroup).not.toHaveBeenCalled();
    expect(screen.getByRole("switch", { name: /respond.*1@g\.us/i })).not.toBeChecked();
  });

  it("disabling managed and toggling the spam notice do not ask for confirmation", async () => {
    setup([{ ...base, managed: true }]);
    await userEvent.click(await screen.findByRole("switch", { name: /respond.*1@g\.us/i }));
    await userEvent.click(screen.getByRole("switch", { name: /spam.*1@g\.us/i }));
    expect(confirm).not.toHaveBeenCalled();
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

  it("toasts success after a save", async () => {
    setup([{ ...base, managed: true }]);
    await userEvent.click(await screen.findByRole("switch", { name: /spam.*1@g\.us/i }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("WA name")));
  });

  it("toasts the error and keeps the old value when saving fails", async () => {
    setup([base]);
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("boom"));
    await userEvent.click(await screen.findByRole("switch", { name: /spam.*1@g\.us/i }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: /spam.*1@g\.us/i })).not.toBeChecked();
  });

  it("failed list save toasts, reloads, and reflects server state", async () => {
    setup([base]);
    vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("nope"));
    const box = await screen.findByRole("switch", { name: /respond.*1@g\.us/i });
    const before = vi.mocked(api.listGroups).mock.calls.length;
    await userEvent.click(box);
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
    await waitFor(() => expect(vi.mocked(api.listGroups).mock.calls.length).toBeGreaterThan(before));
    expect(screen.getByRole("switch", { name: /respond.*1@g\.us/i })).not.toBeChecked();
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
    expect(toast.error).not.toHaveBeenCalled();
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

  const user = userEvent.setup({ pointerEventsCheck: 0 }); // Radix sets pointer-events:none on <body>
  const overlay = () => document.querySelector<HTMLElement>("[data-dialog-overlay]")!;
  const editBtn = () => screen.getByRole("button", { name: /edit 1@g\.us/i });

  it("edit dialog is modal, focuses the name field, closes on Escape and overlay click, returns focus", async () => {
    setup([base]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog", { name: "Edit group" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByLabelText("Display name")).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(editBtn()).toHaveFocus());
    await user.click(editBtn());
    await user.pointer({ keys: "[MouseLeft]", target: overlay() });
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(editBtn()).toHaveFocus());
  });

  it("traps Tab inside the edit dialog and hides the page from assistive tech", async () => {
    setup([base]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    const name = within(dialog).getByLabelText("Display name");
    expect(name).toHaveFocus();
    for (let i = 0; i < 12; i++) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    // Radix hides the rest of the page from assistive tech (only the polite live count stays exposed).
    const search = screen.getByRole("textbox", { name: "Search groups", hidden: true });
    expect(search.closest("[aria-hidden=true]")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Search groups" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(document.body).toHaveAttribute("data-scroll-locked");
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(search.closest("[aria-hidden=true]")).toBeNull();
    expect(document.body).not.toHaveAttribute("data-scroll-locked");
    await waitFor(() => expect(editBtn()).toHaveFocus());
  });

  it("ignores Escape, overlay clicks, Close and Cancel while saving", async () => {
    setup([base]);
    let release!: () => void;
    vi.mocked(api.patchGroup).mockReturnValueOnce(new Promise((r) => { release = () => r(base); }));
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Display name"), "X");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    const saveBtn = within(dialog).getByRole("button", { name: "Save" });
    // Save stays focusable (aria-disabled) so focus is not dropped to <body> while saving
    expect(saveBtn).toHaveAttribute("aria-disabled", "true");
    expect(saveBtn).not.toHaveAttribute("disabled");
    expect(saveBtn).toHaveFocus();
    await user.click(saveBtn);
    await user.keyboard("{Enter}");
    expect(api.patchGroup).toHaveBeenCalledTimes(1);
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Close" })).toBeDisabled();
    await user.keyboard("{Escape}");
    await user.pointer({ keys: "[MouseLeft]", target: overlay() });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    release();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(editBtn()).toHaveFocus());
  });

  it("makes the app root inert while the edit dialog is open, and not after it closes", async () => {
    setup([base]);
    for (let i = 0; i < 2; i++) {
      await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
      const dialog = screen.getByRole("dialog");
      const search = screen.getByRole("textbox", { name: "Search groups", hidden: true });
      expect(search.closest("[inert]")).not.toBeNull();
      expect(dialog.closest("[inert]")).toBeNull();
      await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
      expect(document.querySelectorAll("[inert]")).toHaveLength(0);
      // focus returns once the page is interactive again
      await waitFor(() => expect(editBtn()).toHaveFocus());
    }
  });

  it("leaves no inert attribute behind under StrictMode", async () => {
    vi.mocked(api.listGroups).mockResolvedValue({ items: [base], total: 1 });
    render(<StrictMode><Groups /></StrictMode>);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    expect(screen.getByRole("textbox", { name: "Search groups", hidden: true }).closest("[inert]")).not.toBeNull();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(document.querySelectorAll("[inert]")).toHaveLength(0);
    await waitFor(() => expect(editBtn()).toHaveFocus());
  });

  it("shows the read-only WhatsApp name, topic and owner inside bdi", async () => {
    setup([{ ...base, group_name: "קבוצה", group_topic: "נושא" }]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    for (const t of ["קבוצה", "נושא", "9725@s.whatsapp.net"]) {
      expect(within(dialog).getByText(t).tagName).toBe("BDI");
    }
    expect(within(dialog).queryByRole("textbox", { name: /owner|topic|whatsapp name/i })).not.toBeInTheDocument();
  });

  it("renders a group name with markup as text in the dialog", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    setup([{ ...base, group_name: evil }]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog).toHaveTextContent(evil);
  });

  it("is a bottom sheet on phones and a centred dialog from md", async () => {
    setup([base]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    expect(screen.getByRole("dialog")).toHaveClass("bottom-0", "rounded-t-xl", "md:top-1/2", "md:max-w-md");
  });

  it("returns focus to the search box when the group left the list after saving", async () => {
    setup([base]);
    await user.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
    vi.mocked(api.listGroups).mockResolvedValue({ items: [], total: 0 });
    await user.type(within(screen.getByRole("dialog")).getByLabelText("Display name"), "Gone");
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await screen.findByText("No groups match.");
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Search groups" })).toHaveFocus());
  });

  describe("summary language", () => {
    const sel = () => screen.findByRole("combobox", { name: /summary language for wa name/i });

    it("shows the current value and Auto for null", async () => {
      setup([base, { ...base, group_jid: "2@g.us", group_name: "Other", summary_language: "ru" }]);
      expect(await sel()).toHaveValue("");
      expect(screen.getByRole("combobox", { name: /summary language for other/i })).toHaveValue("ru");
      const opts = within(await sel()).getAllByRole("option").map((o) => o.textContent);
      expect(opts).toEqual(["Auto", "HE", "EN", "RU"]);
    });

    it("sends only summary_language on change and toasts success", async () => {
      setup([base]);
      await userEvent.selectOptions(await sel(), "he");
      await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { summary_language: "he" }));
      await waitFor(() => expect(toast.success).toHaveBeenCalled());
    });

    it("sends null when switching back to Auto", async () => {
      setup([{ ...base, summary_language: "en" }]);
      await userEvent.selectOptions(await sel(), "");
      await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { summary_language: null }));
    });

    it("is disabled while saving", async () => {
      setup([base]);
      let release!: () => void;
      vi.mocked(api.patchGroup).mockReturnValueOnce(new Promise((r) => { release = () => r(base); }));
      await userEvent.selectOptions(await sel(), "en");
      expect(await sel()).toBeDisabled();
      release();
      await waitFor(() => expect(screen.getByRole("combobox", { name: /summary language for wa name/i })).toBeEnabled());
    });

    it("edit dialog shows the language and sends it only when changed", async () => {
      setup([{ ...base, summary_language: "en" }]);
      await userEvent.click(await screen.findByRole("button", { name: /edit 1@g\.us/i }));
      const dialog = screen.getByRole("dialog");
      const select = within(dialog).getByLabelText("Summary language");
      expect(select).toHaveValue("en");
      await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
      expect(api.patchGroup).not.toHaveBeenCalled();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /edit 1@g\.us/i }));
      await userEvent.selectOptions(screen.getByLabelText("Summary language", { selector: "[role=dialog] select" }), "");
      await userEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
      await waitFor(() => expect(api.patchGroup).toHaveBeenCalledWith("1@g.us", { summary_language: null }));
    });

    it("toasts the error and reverts the select on failure", async () => {
      setup([base]);
      vi.mocked(api.patchGroup).mockRejectedValueOnce(new Error("boom"));
      await userEvent.selectOptions(await sel(), "ru");
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
      await waitFor(() => expect(screen.getByRole("combobox", { name: /summary language for wa name/i })).toHaveValue(""));
    });
  });

  it("shows the schedule count and a Schedules button naming the group", async () => {
    setup([{ ...base, display_name: "My alias", schedule_count: 3 }]);
    expect(await screen.findByRole("columnheader", { name: "Schedules" })).toBeInTheDocument();
    const row = screen.getByRole("row", { name: /My alias/ });
    expect(row).toHaveTextContent("3");
    expect(within(row).getByRole("button", { name: "Schedules 3 for My alias" })).toHaveTextContent("Schedules");
  });
});
