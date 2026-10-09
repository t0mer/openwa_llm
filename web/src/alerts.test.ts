import { beforeEach, describe, expect, it, vi } from "vitest";

const fire = vi.fn();
const toastFire = vi.fn();
vi.mock("sweetalert2", () => ({
  default: { fire: (...a: unknown[]) => fire(...a), mixin: () => ({ fire: (...a: unknown[]) => toastFire(...a) }) },
}));

import { confirm, errorDialog, showSummaryResults, summaryIcon, toast } from "./alerts";

beforeEach(() => vi.clearAllMocks());

describe("alerts", () => {
  it("confirm resolves true only when confirmed", async () => {
    fire.mockResolvedValueOnce({ isConfirmed: true });
    expect(await confirm({ title: "Sure?", text: "body", confirmText: "Do it", danger: true })).toBe(true);
    const opts = fire.mock.calls[0][0];
    expect(opts).toMatchObject({ titleText: "Sure?", text: "body", confirmButtonText: "Do it", showCancelButton: true, focusCancel: true });
    fire.mockResolvedValueOnce({ isConfirmed: false, isDismissed: true });
    expect(await confirm({ title: "x" })).toBe(false);
  });

  it("toast helpers pass the message and icon", () => {
    toast.success("Saved");
    toast.error("Boom");
    toast.info("FYI");
    expect(toastFire.mock.calls.map((c) => [c[0].icon, c[0].titleText])).toEqual([
      ["success", "Saved"],
      ["error", "Boom"],
      ["info", "FYI"],
    ]);
  });

  it("errorDialog shows title and message", async () => {
    fire.mockResolvedValueOnce({});
    await errorDialog("Failed", "nope");
    expect(fire.mock.calls[0][0]).toMatchObject({ icon: "error", titleText: "Failed", text: "nope" });
  });

  it("showSummaryResults lists groups with reasons and escapes html", async () => {
    fire.mockResolvedValueOnce({});
    await showSummaryResults([
      { group_name: "<b>A</b>", group_jid: "1@g.us", status: "sent", reason: null, message_count: 20, required: 15 },
      { group_name: "B", group_jid: "2@g.us", status: "skipped", reason: "not_enough_messages", message_count: 9, required: 15 },
      { group_name: "C", group_jid: "3@g.us", status: "failed", reason: "boom", message_count: null, required: null },
    ]);
    const opts = fire.mock.calls[0][0];
    expect(opts.titleText).toBe("Summary results");
    expect(opts.title).toBeUndefined();
    const text = (opts.html as HTMLElement).textContent;
    expect(text).toContain("<b>A</b>");
    expect(text).toContain("9 of 15 messages needed");
    expect(text).toContain("boom");
    expect((opts.html as HTMLElement).querySelector("b")).toBeNull();
    expect(opts.icon).toBe("warning");
  });

  it("showSummaryResults handles an empty list", async () => {
    fire.mockResolvedValueOnce({});
    await showSummaryResults([], "No managed groups");
    expect((fire.mock.calls[0][0].html as HTMLElement).textContent).toContain("No managed groups");
  });

  it("picks the results icon by outcome mix", () => {
    expect(summaryIcon({ sent: 3, skipped: 0, failed: 0 }, 3)).toBe("success");
    expect(summaryIcon({ sent: 2, skipped: 0, failed: 1 }, 3)).toBe("warning");
    expect(summaryIcon({ sent: 1, skipped: 2, failed: 0 }, 3)).toBe("warning");
    expect(summaryIcon({ sent: 0, skipped: 0, failed: 3 }, 3)).toBe("error");
    expect(summaryIcon({ sent: 0, skipped: 3, failed: 0 }, 3)).toBe("info");
    expect(summaryIcon({ sent: 0, skipped: 0, failed: 0 }, 0)).toBe("warning");
  });
});
