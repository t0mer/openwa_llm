import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const css = read("./index.css");
const main = read("./main.tsx");
const indexHtml = read("../index.html");

function block(selector: string): Record<string, string> {
  const re = new RegExp(`(?:^|\\n)${selector.replace(/[.:]/g, "\\$&")} \\{([^}]*)\\}`);
  const m = re.exec(css);
  expect(m, `block ${selector}`).not.toBeNull();
  const out: Record<string, string> = {};
  for (const d of m![1].matchAll(/(--[\w-]+):\s*([^;]+);/g)) out[d[1]] = d[2].trim();
  return out;
}

const LIGHT = {
  "--background": "#f4f3fa", "--surface": "#ffffff", "--surface-2": "#ecebf6", "--foreground": "#14122b",
  "--muted-foreground": "#5b577a", "--border": "#dcd9ee", "--border-strong": "#bdb8dc", "--primary": "#5e4cc2",
  "--primary-foreground": "#ffffff", "--primary-soft": "#e7e3fa", "--ring": "#5e4cc2", "--danger": "#b8383a",
  "--danger-soft": "#fbe5e4", "--warning": "#8d5a0f", "--warning-soft": "#fbefd5", "--success": "#25735a",
  "--success-soft": "#dcf1e8", "--shadow": "0 10px 30px -12px rgb(20 18 43 / 0.35)",
};
const DARK = {
  "--background": "#100e24", "--surface": "#1a1838", "--surface-2": "#231f47", "--foreground": "#eceaf8",
  "--muted-foreground": "#a6a2c8", "--border": "#2e2a58", "--border-strong": "#433e7a", "--primary": "#a89bf2",
  "--primary-foreground": "#14122b", "--primary-soft": "#2c2761", "--ring": "#c4baf7", "--danger": "#f08682",
  "--danger-soft": "#45202a", "--warning": "#eab45c", "--warning-soft": "#3d2f17", "--success": "#62c9a5",
  "--success-soft": "#173a31", "--shadow": "0 10px 30px -12px rgb(0 0 0 / 0.7)",
};

describe("index.css tokens", () => {
  it("defines the exact light tokens on :root", () => {
    expect(block(":root")).toMatchObject(LIGHT);
  });
  it("defines the exact dark tokens on :root.dark", () => {
    expect(block(":root.dark")).toMatchObject(DARK);
  });
  it("uses a class-based dark variant", () => {
    expect(css).toContain("@custom-variant dark (&:where(.dark, .dark *));");
  });
  it("maps every token into the Tailwind theme and sets font and radii", () => {
    const theme = /@theme inline \{([^}]*)\}/.exec(css)![1];
    for (const name of Object.keys(LIGHT).filter((k) => k !== "--shadow")) {
      expect(theme).toContain(`--color-${name.slice(2)}: var(${name});`);
    }
    expect(theme).toContain("--shadow-overlay: var(--shadow);");
    expect(theme).toContain(
      `--font-sans: "Rubik Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;`,
    );
    for (const r of ["sm: 6px", "md: 10px", "lg: 16px", "xl: 28px"]) expect(theme).toContain(`--radius-${r};`);
  });
  it("sets the base: 15px/1.5 body, legibility, focus ring", () => {
    expect(css).toMatch(/font-family: var\(--font-sans\);\s*font-size: 15px;\s*line-height: 1\.5;\s*text-rendering: optimizeLegibility;/);
    expect(css).toMatch(/:focus-visible \{\s*outline: 2px solid var\(--ring\);\s*outline-offset: 2px;/);
    expect(css).toContain(".tabular");
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
  it("imports the bundled Rubik font and no external font host", () => {
    expect(main).toContain('import "@fontsource-variable/rubik";');
    expect(css).not.toContain("googleapis");
    expect(indexHtml).not.toContain("googleapis");
  });
});
