import { describe, expect, it } from "vitest";
import css from "./styles.css?raw";

describe("styles.css", () => {
  it("has balanced braces", () => {
    let depth = 0;
    for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, "")) {
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(css.length).toBeGreaterThan(1000);
    expect(depth).toBe(0);
  });

  it("keeps the top-level .cell-actions rule", () => {
    expect(css).toMatch(/\n\.cell-actions \{ white-space: nowrap; \}/);
  });

  it("hides the burger by default and shows it only inside the max-width media query", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const stack: string[] = [];
    const burgerDisplays: { inMedia: boolean; value: string }[] = [];
    for (const m of stripped.matchAll(/([^{}]*)\{|([^{}]*)\}/g)) {
      if (m[1] !== undefined) {
        stack.push(m[1].trim());
      } else {
        const sel = stack.pop() ?? "";
        const d = /display:\s*([\w-]+)/.exec(m[2]);
        if (d && sel.split(",").some((x) => /^(button)?\.burger$/.test(x.trim()))) {
          burgerDisplays.push({ inMedia: stack.some((x) => x.startsWith("@media")), value: d[1] });
        }
      }
    }
    expect(burgerDisplays).toEqual([
      { inMedia: false, value: "none" },
      { inMedia: true, value: "inline-flex" },
    ]);
    // the base rule must be at least as specific as the generic button rule so it wins
    expect(css).toMatch(/\nbutton\.burger \{ display: none;/);
  });

  it("styles the schedules dialog with a stacked single-column layout on narrow screens", () => {
    const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).toMatch(/\.schedule-row \{[^}]*grid-template-columns: 1fr auto/);
    const media = /@media \(max-width: 720px\) \{\s*\.schedule-row \{[^}]*grid-template-columns: 1fr;/;
    expect(stripped).toMatch(media);
    expect(stripped).toMatch(/\.modal\.modal-wide \{[^}]*overflow-y: auto/);
  });
});
