// Unmocked SweetAlert2: attacker-controlled names must never become DOM elements.
import Swal from "sweetalert2";
import { afterEach, describe, expect, it } from "vitest";
import { confirm, deferredToasts, errorDialog, showSummaryResults, toast } from "./alerts";

// jsdom has no matchMedia, which SweetAlert2 uses when rendering icons.
window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;

window.scrollTo = (() => {}) as never;

const injected = () => document.body.querySelector("img[src='x'], img[onerror]");
const flush = () => new Promise((r) => setTimeout(r, 30));
const EVIL = "<img src=x onerror=alert(1)>";

afterEach(async () => {
  await flush();
  Swal.close();
  await flush();
  await flush();
});

describe("alerts never render data as HTML", () => {
  it("confirm", async () => {
    void confirm({ title: `Enable ${EVIL}?`, text: EVIL });
    await flush();
    expect(injected()).toBeNull();
    expect(document.body.textContent).toContain(EVIL);
  });

  it("toast", async () => {
    toast.success(`Saved ${EVIL}`);
    await flush();
      expect(injected()).toBeNull();
    // titleText uses innerText, which jsdom does not implement, so the text itself is not asserted here.
  });

  it("errorDialog", async () => {
    void errorDialog(EVIL, EVIL);
    await flush();
    expect(injected()).toBeNull();
  });

  it("showSummaryResults", async () => {
    void showSummaryResults([
      { group_name: EVIL, group_jid: "1@g.us", status: "failed", reason: EVIL, message_count: null, required: null },
    ]);
    await flush();
    expect(injected()).toBeNull();
    expect(document.body.textContent).toContain(EVIL);
  });

  it("a toast raised while a confirm is open does not dismiss the confirm", async () => {
    let settled: boolean | undefined;
    void confirm({ title: "Sure?" }).then((v) => { settled = v; });
    await flush();
    toast.success("Saved");
    void showSummaryResults([]);
    await flush();
    expect(settled).toBeUndefined();
    expect(document.querySelector(".swal2-container:not(.swal2-top-end) .swal2-confirm")).not.toBeNull();
    Swal.clickConfirm();
    await flush();
    expect(settled).toBe(true);
    // the queued results modal now shows; close it, then the deferred toast appears
    expect(document.body.textContent).toContain("No groups were processed.");
    Swal.clickConfirm();
    await flush();
    await flush();
    expect(document.querySelector(".swal-toast")).not.toBeNull();
  });

  it("keeps a small FIFO of deferred toasts, dropping the oldest", async () => {
    void confirm({ title: "Sure?" });
    await flush();
    for (const m of ["t1", "t2", "t3", "t4"]) toast.info(m);
    expect(deferredToasts()).toEqual(["t2", "t3", "t4"]);
    Swal.clickCancel();
    await flush();
  });
});
