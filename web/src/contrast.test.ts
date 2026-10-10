// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./index.css", import.meta.url), "utf8");

function tokens(selector: string): Record<string, string> {
  const m = new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)!;
  const out: Record<string, string> = {};
  for (const d of m[1].matchAll(/--([\w-]+):\s*(#[0-9a-f]{6});/gi)) out[d[1]] = d[2];
  return out;
}

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = ["background", "surface", "surface-2"];
const SOFT = { primary: "primary-soft", danger: "danger-soft", warning: "warning-soft", success: "success-soft" } as const;

/** [foreground token, background token] pairs of text actually rendered in the UI. */
const TEXT_PAIRS: [string, string][] = [
  ...["foreground", "muted-foreground", "primary", "danger", "warning", "success"].flatMap((fg) =>
    SURFACES.map((bg): [string, string] => [fg, bg]),
  ),
  ["foreground", "primary-soft"],
  ["muted-foreground", "primary-soft"],
  ["primary", "primary-soft"],
  ["danger", "danger-soft"],
  ["warning", "warning-soft"],
  ["success", "success-soft"],
  ["primary-foreground", "primary"],
  ["primary-foreground", "danger"],
];

describe.each([
  ["light", tokens(":root")],
  ["dark", tokens(":root.dark")],
])("WCAG contrast, %s theme", (_name, t) => {
  it("parses every token used", () => {
    for (const k of [...SURFACES, ...Object.values(SOFT), "foreground", "muted-foreground", "primary", "danger", "warning", "success", "primary-foreground"]) {
      expect(t[k], k).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
  it.each(TEXT_PAIRS)("text %s on %s is at least 4.5:1", (fg, bg) => {
    const ratio = contrast(t[fg], t[bg]);
    expect(ratio, `${fg} ${t[fg]} on ${bg} ${t[bg]} = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(4.5);
  });
});

describe("contrast helper", () => {
  it("matches the WCAG reference values", () => {
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(contrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});
