// SweetAlert2 is themed from the same tokens as the rest of the UI (unmocked, in jsdom).
import Swal from "sweetalert2";
import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { confirm, errorDialog, toast } from "./alerts";

window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never;
window.scrollTo = (() => {}) as never;

const flush = () => new Promise((r) => setTimeout(r, 30));
const css = readFileSync("src/index.css", "utf8");
const alertsSrc = readFileSync("src/alerts.ts", "utf8");
const swalCss = css.slice(css.indexOf("/* SweetAlert2 theme"));

afterEach(async () => {
  await flush();
  Swal.close();
  await flush();
  await flush();
});

describe("SweetAlert2 theme", () => {
  it("confirm uses the Button primary/outline classes", async () => {
    void confirm({ title: "Sure?" });
    await flush();
    const ok = document.querySelector(".swal2-confirm")!;
    const cancel = document.querySelector(".swal2-cancel")!;
    expect(ok).toHaveClass("bg-primary", "text-primary-foreground", "rounded-md", "font-medium");
    expect(cancel).toHaveClass("border-border-strong", "bg-surface", "rounded-md");
    expect(ok.className).not.toMatch(/\bbtn\b/);
  });

  it("a dangerous confirm uses the danger button", async () => {
    void confirm({ title: "Delete?", danger: true, confirmText: "Delete" });
    await flush();
    expect(document.querySelector(".swal2-confirm")).toHaveClass("bg-danger");
  });

  it("error dialogs and toasts carry the themed popup classes", async () => {
    void errorDialog("Oops", "bad");
    await flush();
    expect(document.querySelector(".swal2-popup")).toHaveClass("swal-popup");
    Swal.close();
    await flush();
    toast.info("hi");
    await flush();
    expect(document.querySelector(".swal2-popup.swal2-toast")).toHaveClass("swal-popup", "swal-toast");
  });

  it("styles popups, toasts, icons, buttons and backdrop only from tokens", () => {
    expect(swalCss.length).toBeGreaterThan(500);
    for (const token of ["--surface", "--foreground", "--border", "--muted-foreground", "--success", "--danger", "--warning", "--primary", "--shadow", "--font-sans", "--radius-lg"])
      expect(swalCss).toContain(`var(${token})`);
    // no hard-coded colours except the overlay colour shared with the Dialog overlay
    const hex = [...swalCss.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase());
    expect(hex.filter((h) => h !== "#14122b")).toEqual([]);
    expect(swalCss).toContain(".swal2-container.swal2-backdrop-show");
    expect(swalCss).toMatch(/swal2-icon\.swal2-success/);
    expect(swalCss).toMatch(/swal2-icon\.swal2-error/);
    expect(swalCss).toMatch(/swal2-icon\.swal2-warning/);
    expect(swalCss).toMatch(/swal2-icon\.swal2-info/);
    expect(swalCss).not.toMatch(/\.dark/); // follows the tokens, so no per-theme rules needed
  });

  it("keeps the text-only rule: no HTML-capable options carry data", () => {
    const code = alertsSrc.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/\btitle:\s+(?!string\b|"swal-title")/); // only typed params and the CSS class name
    expect(code).not.toMatch(/\bfooter:/);
    expect(code).toMatch(/titleText: title/);
    // the single html option is a DOM node built with textContent
    expect(code.match(/\bhtml:/g)).toEqual(["html:"]);
    expect(code).toContain("html: root");
    expect(code).not.toContain("innerHTML");
  });
});
