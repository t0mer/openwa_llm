import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SchedulesDialog, { describeReason } from "./SchedulesDialog";
import Groups from "../pages/Groups";
import { api } from "../api";
import type { Group, Schedule } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return {
    ...actual,
    api: {
      listGroups: vi.fn(), patchGroup: vi.fn(),
      listSchedules: vi.fn(), createSchedule: vi.fn(), patchSchedule: vi.fn(), deleteSchedule: vi.fn(),
    },
  };
});
vi.mock("../alerts");
import { confirm, toast } from "../alerts";

const sched = (over: Partial<Schedule> = {}): Schedule => ({
  id: "s1", weekdays: [1, 3], hour: 9, minute: 30, hour12: 9, meridiem: "AM", enabled: true,
  last_run_at: null, last_status: null, last_reason: null, last_message_count: null, ...over,
});
const grp = { group_jid: "1@g.us", label: "Friends", managed: true };

function open(items: Schedule[], group = grp) {
  vi.mocked(api.listSchedules).mockResolvedValue({ timezone: "Asia/Jerusalem", items });
  const onClose = vi.fn();
  const onChanged = vi.fn();
  render(<SchedulesDialog group={group} onClose={onClose} onChanged={onChanged} />);
  return { onClose, onChanged };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("SchedulesDialog", () => {
  it("shows the time zone, schedules and labelled controls", async () => {
    open([sched()]);
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("Asia/Jerusalem")).toBeInTheDocument();
    const row = await within(dialog).findByRole("group", { name: "Schedule 1" });
    for (const [i, name] of ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].entries()) {
      const box = within(row).getByRole("checkbox", { name });
      if ([1, 3].includes(i)) expect(box).toBeChecked(); else expect(box).not.toBeChecked();
    }
    expect(within(row).getByLabelText("Hour")).toHaveValue("9");
    expect(within(row).getByLabelText("Minute")).toHaveValue("30");
    expect(within(row).getByLabelText("AM or PM")).toHaveValue("AM");
    expect(within(row).getByRole("checkbox", { name: "Enabled" })).toBeChecked();
    expect(within(row).getByLabelText("Hour").querySelectorAll("option")).toHaveLength(12);
    expect(within(row).getByLabelText("Minute").querySelectorAll("option")).toHaveLength(60);
    expect(within(row).getByText("Never run")).toBeInTheDocument();
  });

  it("renders the last run with badge, friendly reason and message count", async () => {
    open([sched({ last_run_at: "2026-10-01T08:00:00Z", last_status: "skipped", last_reason: "not_enough_messages", last_message_count: 4 })]);
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    expect(within(row).getByText("skipped")).toHaveClass("badge", "warn");
    expect(row).toHaveTextContent("Not enough new messages");
    expect(row).toHaveTextContent("4 messages");
    expect(describeReason("lock_timeout")).toMatch(/still running/);
    expect(describeReason("something_new")).toBe("something new");
    expect(describeReason(null)).toBeNull();
  });

  it("shows the not-managed note only for unmanaged groups", async () => {
    open([], { ...grp, managed: false });
    expect(await screen.findByText("Schedules only run for managed groups.")).toBeInTheDocument();
  });

  it("does not show the note for managed groups", async () => {
    open([]);
    await screen.findByText("No schedules yet.");
    expect(screen.queryByText(/only run for managed/)).not.toBeInTheDocument();
  });

  it.each([
    ["12 AM", "12", "AM", 12, "AM"],
    ["12 PM", "12", "PM", 12, "PM"],
    ["11:59 PM", "11", "PM", 11, "PM"],
  ])("creates %s as the 12-hour form", async (_n, hour, mer, h12, m) => {
    open([]);
    vi.mocked(api.createSchedule).mockResolvedValue(sched({ id: "n" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add schedule" }));
    const row = screen.getByRole("group", { name: "Schedule 1" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Mon" }));
    await userEvent.selectOptions(within(row).getByLabelText("Hour"), hour);
    await userEvent.selectOptions(within(row).getByLabelText("Minute"), mer === "PM" && hour === "11" ? "59" : "0");
    await userEvent.selectOptions(within(row).getByLabelText("AM or PM"), mer);
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() =>
      expect(api.createSchedule).toHaveBeenCalledWith("1@g.us", {
        weekdays: [1], hour12: h12, meridiem: m, minute: hour === "11" ? 59 : 0, enabled: true,
      }),
    );
  });

  it("add schedule starts with no days, 9:00 AM, and blocks save with an inline alert", async () => {
    const { onChanged } = open([]);
    await userEvent.click(await screen.findByRole("button", { name: "Add schedule" }));
    const row = screen.getByRole("group", { name: "Schedule 1" });
    expect(within(row).getByLabelText("Hour")).toHaveValue("9");
    expect(within(row).getByLabelText("Minute")).toHaveValue("0");
    expect(within(row).getByLabelText("AM or PM")).toHaveValue("AM");
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    expect(within(row).getByRole("alert")).toHaveTextContent("Select at least one day");
    expect(api.createSchedule).not.toHaveBeenCalled();
    await userEvent.click(within(row).getByRole("checkbox", { name: "Sun" }));
    expect(within(row).queryByRole("alert")).not.toBeInTheDocument();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("toasts and notifies the parent after a create", async () => {
    const { onChanged } = open([]);
    vi.mocked(api.createSchedule).mockResolvedValue(sched({ id: "n" }));
    await userEvent.click(await screen.findByRole("button", { name: "Add schedule" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Sun" }));
    await userEvent.click(screen.getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining("Friends")));
    expect(onChanged).toHaveBeenCalledTimes(1);
    // now a saved row: patching is possible and Save is disabled until something changes
    expect(screen.getByRole("button", { name: "Save schedule 1" })).toBeDisabled();
  });

  it("patches only the changed fields", async () => {
    open([sched()]);
    vi.mocked(api.patchSchedule).mockResolvedValue(sched({ enabled: false }));
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() => expect(api.patchSchedule).toHaveBeenCalledWith("1@g.us", "s1", { enabled: false }));
    expect(toast.success).toHaveBeenCalled();
  });

  it("sends the whole 12-hour time form when any time field changes", async () => {
    open([sched()]);
    vi.mocked(api.patchSchedule).mockResolvedValue(sched({ hour12: 9, meridiem: "PM", hour: 21 }));
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    await userEvent.selectOptions(within(row).getByLabelText("AM or PM"), "PM");
    await userEvent.click(within(row).getByRole("checkbox", { name: "Fri" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() =>
      expect(api.patchSchedule).toHaveBeenCalledWith("1@g.us", "s1", { weekdays: [1, 3, 5], hour12: 9, meridiem: "PM", minute: 30 }),
    );
  });

  it("does not patch when all days are cleared", async () => {
    open([sched({ weekdays: [2] })]);
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Tue" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    expect(within(row).getByRole("alert")).toBeInTheDocument();
    expect(api.patchSchedule).not.toHaveBeenCalled();
  });

  it("toasts the server error and keeps the draft when saving fails", async () => {
    open([sched()]);
    vi.mocked(api.patchSchedule).mockRejectedValue(new Error("boom"));
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("boom"));
    expect(within(row).getByRole("checkbox", { name: "Enabled" })).not.toBeChecked();
    expect(within(row).getByRole("button", { name: "Save schedule 1" })).toBeEnabled();
  });

  it("disables the row controls and blocks closing while saving", async () => {
    const { onClose } = open([sched()]);
    let release!: (s: Schedule) => void;
    vi.mocked(api.patchSchedule).mockReturnValue(new Promise((r) => { release = r; }));
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    await userEvent.click(within(row).getByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(within(row).getByRole("button", { name: "Save schedule 1" }));
    expect(within(row).getByRole("button", { name: "Save schedule 1" })).toBeDisabled();
    expect(within(row).getByLabelText("Hour")).toBeDisabled();
    expect(within(row).getByRole("checkbox", { name: "Mon" })).toBeDisabled();
    expect(within(row).getByRole("button", { name: "Delete schedule 1" })).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    await userEvent.pointer({ keys: "[MouseLeft]", target: screen.getByRole("dialog").parentElement! });
    expect(onClose).not.toHaveBeenCalled();
    release(sched({ enabled: false }));
    await waitFor(() => expect(within(row).getByLabelText("Hour")).toBeEnabled());
  });

  it("asks for confirmation before deleting and deletes after confirm", async () => {
    const { onChanged } = open([sched()]);
    vi.mocked(api.deleteSchedule).mockResolvedValue(undefined);
    await userEvent.click(await screen.findByRole("button", { name: "Delete schedule 1" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ danger: true, confirmText: "Delete" });
    await waitFor(() => expect(api.deleteSchedule).toHaveBeenCalledWith("1@g.us", "s1"));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Schedule 1" })).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    open([sched()]);
    await userEvent.click(await screen.findByRole("button", { name: "Delete schedule 1" }));
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Schedule 1" })).toBeInTheDocument();
  });

  it("removes an unsaved row locally without calling the API or confirming", async () => {
    open([]);
    await userEvent.click(await screen.findByRole("button", { name: "Add schedule" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove schedule 1" }));
    expect(confirm).not.toHaveBeenCalled();
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    expect(screen.queryByRole("group", { name: "Schedule 1" })).not.toBeInTheDocument();
  });

  it("toasts when a delete fails and keeps the row", async () => {
    open([sched()]);
    vi.mocked(api.deleteSchedule).mockRejectedValue(new Error("nope"));
    await userEvent.click(await screen.findByRole("button", { name: "Delete schedule 1" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("nope"));
    expect(screen.getByRole("group", { name: "Schedule 1" })).toBeInTheDocument();
  });

  it("disables Add schedule at 20 schedules", async () => {
    open(Array.from({ length: 20 }, (_, i) => sched({ id: `s${i}` })));
    await screen.findByRole("group", { name: "Schedule 20" });
    expect(screen.getByRole("button", { name: "Add schedule" })).toBeDisabled();
    expect(screen.getByText(/limit of 20/i)).toBeInTheDocument();
  });

  it("shows a load error inline", async () => {
    vi.mocked(api.listSchedules).mockRejectedValue(new Error("group not found"));
    render(<SchedulesDialog group={grp} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("group not found");
    expect(screen.getByRole("button", { name: "Add schedule" })).toBeDisabled();
  });

  it("is a modal that focuses inside, closes on Escape, traps Tab and makes the page inert", async () => {
    const { onClose } = open([sched()]);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName(/Friends/);
    const close = within(dialog).getByRole("button", { name: "Close" });
    expect(close).toHaveFocus();
    await userEvent.tab();
    expect(within(dialog).getByRole("checkbox", { name: "Sun" })).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(close).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on backdrop click", async () => {
    const { onClose } = open([]);
    const dialog = await screen.findByRole("dialog");
    await userEvent.pointer({ keys: "[MouseLeft]", target: dialog.parentElement! });
    expect(onClose).toHaveBeenCalled();
  });

  it("renders group names as text, never HTML", async () => {
    const evil = '<img src=x onerror="alert(1)">';
    open([sched()], { ...grp, label: evil });
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toBeNull();
    expect(dialog).toHaveTextContent(evil);
    vi.mocked(api.patchSchedule).mockResolvedValue(sched({ enabled: false }));
    await userEvent.click(await screen.findByRole("checkbox", { name: "Enabled" }));
    await userEvent.click(screen.getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringContaining(evil)));
    await userEvent.click(screen.getByRole("button", { name: "Delete schedule 1" }));
    expect(vi.mocked(confirm).mock.calls[0][0]).toMatchObject({ text: expect.stringContaining(evil) });
  });

  it("uses the stacked-card markup classes", async () => {
    open([sched()]);
    const row = await screen.findByRole("group", { name: "Schedule 1" });
    expect(row).toHaveClass("schedule-row");
    expect(row.closest(".modal")).toHaveClass("modal-wide");
  });
});

describe("Groups integration", () => {
  const g: Group = {
    group_jid: "1@g.us", group_name: "WA", display_name: null, group_topic: null, owner_jid: null,
    managed: false, notify_on_spam: false, summary_language: null, community_keys: [],
    last_summary_sync: "2026-01-02T03:04:05", last_ingest: "2026-01-02T03:04:05", message_count: 1, schedule_count: 0,
  };

  it("opens the dialog for the group, refreshes the list after a create, and restores focus on close", async () => {
    vi.mocked(api.listGroups).mockResolvedValue({ items: [g], total: 1 });
    vi.mocked(api.listSchedules).mockResolvedValue({ timezone: "UTC", items: [] });
    vi.mocked(api.createSchedule).mockResolvedValue(sched());
    render(<Groups />);
    const opener = await screen.findByRole("button", { name: "Schedules for WA" });
    await userEvent.click(opener);
    expect(api.listSchedules).toHaveBeenCalledWith("1@g.us");
    expect(await screen.findByText("Schedules only run for managed groups.")).toBeInTheDocument();
    const before = vi.mocked(api.listGroups).mock.calls.length;
    await userEvent.click(screen.getByRole("button", { name: "Add schedule" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Sun" }));
    await userEvent.click(screen.getByRole("button", { name: "Save schedule 1" }));
    await waitFor(() => expect(vi.mocked(api.listGroups).mock.calls.length).toBeGreaterThan(before));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });
});
