// Unmocked SweetAlert2: attacker-controlled names must never become DOM elements.
import Swal from "sweetalert2";
import { afterEach, describe, expect, it } from "vitest";
import { confirm, errorDialog, showSummaryResults, toast } from "./alerts";

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
});
