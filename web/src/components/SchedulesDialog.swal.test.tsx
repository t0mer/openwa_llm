// Unmocked SweetAlert2 over the Radix dialog: the confirm must be usable (focus, Escape, clicks)
// while the dialog underneath stays open and modal.
import Swal from "sweetalert2";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulesDialog from "./SchedulesDialog";
import { api } from "../api";
import type { Schedule } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return { ...actual, api: { listSchedules: vi.fn(), deleteSchedule: vi.fn(), patchSchedule: vi.fn(), createSchedule: vi.fn() } };
});

// jsdom has no matchMedia, which SweetAlert2 uses when rendering icons.
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
window.scrollTo = (() => {}) as never;

const flush = () => new Promise((r) => setTimeout(r, 30));
const user = userEvent.setup({ pointerEventsCheck: 0 }); // Radix sets pointer-events:none on <body>
const sched: Schedule = {
  id: "s1", weekdays: [1], hour: 9, minute: 30, hour12: 9, meridiem: "AM", enabled: true,
  last_run_at: null, last_status: null, last_reason: null, last_message_count: null,
};
const popup = () => document.querySelector<HTMLElement>(".swal2-container .swal2-popup:not(.swal2-toast)");

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSchedules).mockResolvedValue({ timezone: "UTC", items: [sched] });
  vi.mocked(api.deleteSchedule).mockResolvedValue(undefined);
});

afterEach(async () => {
  Swal.close();
  await flush();
  await flush();
});

async function openConfirm() {
  const onClose = vi.fn();
  render(<SchedulesDialog group={{ group_jid: "1@g.us", label: "Friends", managed: true }} onClose={onClose} onChanged={vi.fn()} />);
  await user.click(await screen.findByRole("button", { name: "Delete schedule at 9:30 AM" }));
  await waitFor(() => expect(popup()).not.toBeNull());
  await flush();
  return onClose;
}

describe("SchedulesDialog with a real SweetAlert confirm", () => {
  it("keeps focus in the confirm instead of pulling it back into the dialog", async () => {
    await openConfirm();
    await waitFor(() => expect(popup()!.contains(document.activeElement)).toBe(true));
    await flush();
    expect(popup()!.contains(document.activeElement)).toBe(true);
    // moving focus between the confirm's buttons is not undone by the dialog's focus trap
    const confirmBtn = popup()!.querySelector<HTMLElement>(".swal2-confirm")!;
    confirmBtn.focus();
    await flush();
    expect(confirmBtn).toHaveFocus();
  });

  it("Escape closes only the confirm; the dialog stays open and nothing is deleted", async () => {
    const onClose = await openConfirm();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(popup()).toBeNull());
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(api.deleteSchedule).not.toHaveBeenCalled();
    // focus is back inside the dialog
    await waitFor(() => expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(true));
  });

  it("clicking the confirm button deletes without closing the dialog", async () => {
    const onClose = await openConfirm();
    await user.click(popup()!.querySelector<HTMLElement>(".swal2-confirm")!);
    await waitFor(() => expect(api.deleteSchedule).toHaveBeenCalledWith("1@g.us", "s1"));
    await flush();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("group", { name: "Schedule at 9:30 AM" })).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add schedule" })).toHaveFocus());
  });
});
