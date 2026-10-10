// Real SweetAlert2 together with Radix dialogs: SweetAlert records and later restores aria-hidden on
// the <body> children. Closing a Radix dialog in between must not leave the app hidden.
import Swal from "sweetalert2";
import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SchedulesDialog from "./components/SchedulesDialog";
import { Dialog, DialogContent } from "./components/ui/dialog";
import { confirm } from "./alerts";
import { api } from "./api";
import type { Schedule } from "./types";

vi.mock("./api", async (orig) => {
  const actual = await orig<typeof import("./api")>();
  return { ...actual, api: { listSchedules: vi.fn(), deleteSchedule: vi.fn(), patchSchedule: vi.fn(), createSchedule: vi.fn() } };
});

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
window.scrollTo = (() => {}) as never;

const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const user = userEvent.setup({ pointerEventsCheck: 0 });
/** The Radix dialog (SweetAlert popups also have role=dialog). */
const radixDialog = () => document.querySelector("[role=dialog]:not(.swal2-popup)");
const popup = () => document.querySelector<HTMLElement>(".swal2-container .swal2-popup:not(.swal2-toast)");
const sched: Schedule = {
  id: "s1", weekdays: [1], hour: 9, minute: 30, hour12: 9, meridiem: "AM", enabled: true,
  last_run_at: null, last_status: null, last_reason: null, last_message_count: null,
};

/**
 * jsdom has no CSS animations, so SweetAlert would tear down synchronously. Report an animation on
 * its popups so it waits for `animationend` like a browser, which the test then fires by hand.
 */
function simulateSwalAnimation() {
  const real = window.getComputedStyle.bind(window);
  return vi.spyOn(window, "getComputedStyle").mockImplementation((el: Element, pseudo?: string | null) => {
    const style = real(el, pseudo);
    if (!(el instanceof HTMLElement) || !el.classList.contains("swal2-popup")) return style;
    return new Proxy(style, {
      get(target, prop) {
        if (prop === "getPropertyValue") return (name: string) => (name === "animation-duration" ? "0.3s" : target.getPropertyValue(name));
        const v = Reflect.get(target, prop, target);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
  });
}

function finishAnimation(el: HTMLElement) {
  el.dispatchEvent(new Event("animationend"));
}

/** No aria-hidden left over on the app root (or its record from SweetAlert). */
function expectExposed(el: Element) {
  expect(el).not.toHaveAttribute("aria-hidden");
  expect(el).not.toHaveAttribute("data-previous-aria-hidden");
}

let spy: ReturnType<typeof simulateSwalAnimation>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.listSchedules).mockResolvedValue({ timezone: "UTC", items: [sched] });
  spy = simulateSwalAnimation();
});
afterEach(async () => {
  Swal.close();
  document.querySelectorAll<HTMLElement>(".swal2-popup").forEach(finishAnimation);
  await flush(150);
  await flush();
  spy.mockRestore();
});

describe("SweetAlert + Radix aria-hidden bookkeeping", () => {
  it("confirm resolves only after SweetAlert has fully closed", async () => {
    let settled: boolean | undefined;
    void confirm({ title: "Sure?" }).then((v) => { settled = v; });
    await waitFor(() => expect(popup()).not.toBeNull());
    const p = popup()!;
    Swal.clickConfirm();
    await flush();
    expect(settled).toBeUndefined(); // the hide animation is still running
    finishAnimation(p);
    await waitFor(() => expect(settled).toBe(true));
    expect(document.querySelector(".swal2-container")).toBeNull();
  });

  it("Schedules: Close -> Discard -> the dialog closes and the app is not left aria-hidden", async () => {
    function Harness() {
      const [open, setOpen] = useState(true);
      return (
        <main>
          <h1>App</h1>
          {open && <SchedulesDialog group={{ group_jid: "1@g.us", label: "Friends", managed: true }} onClose={() => setOpen(false)} onChanged={() => {}} />}
        </main>
      );
    }
    const { container } = render(<Harness />);
    const row = await screen.findByRole("group", { name: "Schedule at 9:30 AM" });
    await user.click(within(row).getByRole("switch", { name: "Enabled" }));
    await user.click(screen.getAllByRole("button", { name: "Close" })[1]);
    await waitFor(() => expect(popup()).not.toBeNull());
    const p = popup()!;
    await user.click(p.querySelector<HTMLElement>(".swal2-confirm")!);
    await flush();
    expect(radixDialog()).not.toBeNull(); // still waiting for SweetAlert to finish closing
    finishAnimation(p);
    await waitFor(() => expect(radixDialog()).toBeNull());
    await flush(150);
    expectExposed(container);
    expect(screen.getByRole("heading", { name: "App" })).toBeInTheDocument();
  });

  it("a Radix dialog unmounted while a SweetAlert modal is open does not leave the app aria-hidden", async () => {
    function Harness({ open }: { open: boolean }) {
      return (
        <main>
          <h1>Login</h1>
          <Dialog open={open}>
            <DialogContent title="Edit">x</DialogContent>
          </Dialog>
        </main>
      );
    }
    const { container, rerender } = render(<Harness open />);
    await waitFor(() => expect(radixDialog()).not.toBeNull());
    let settled = false;
    void confirm({ title: "Session expired" }).then(() => { settled = true; });
    await waitFor(() => expect(popup()).not.toBeNull());
    const p = popup()!;
    rerender(<Harness open={false} />); // e.g. a 401 logout unmounts the page with its dialog
    await waitFor(() => expect(radixDialog()).toBeNull());
    expect(container).toHaveAttribute("aria-hidden", "true"); // still behind the SweetAlert modal
    Swal.clickCancel();
    finishAnimation(p);
    await waitFor(() => expect(settled).toBe(true));
    expectExposed(container);
    expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
  });
});
