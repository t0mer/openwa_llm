// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

type Out = { fileName: string; type: string; source?: string | Uint8Array; code?: string };
let files: Out[] = [];
let css = "";

beforeAll(async () => {
  // write:false keeps the disk untouched; mode "production" matches `npm run build`.
  const result = await build({
    configFile: "vite.config.ts",
    mode: "production",
    logLevel: "silent",
    build: { write: false, emptyOutDir: false },
  });
  const outputs = Array.isArray(result) ? result : [result as { output: Out[] }];
  files = outputs.flatMap((r) => (r as { output: Out[] }).output);
  css = files.filter((f) => f.fileName.endsWith(".css")).map((f) => String(f.source)).join("\n");
}, 60_000);

/** Split minified CSS into top-level blocks, tracking brace depth. */
function topLevel(src: string): { head: string; body: string }[] {
  const out: { head: string; body: string }[] = [];
  let depth = 0;
  let start = 0;
  let head = "";
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") {
      if (depth === 0) head = src.slice(start, i).trim();
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        out.push({ head, body: src.slice(src.indexOf("{", start) + 1, i) });
        start = i + 1;
      }
    } else if (ch === ";" && depth === 0) {
      out.push({ head: src.slice(start, i).trim(), body: "" });
      start = i + 1;
    }
  }
  return out;
}

describe("production bundle", () => {
  it("emits Rubik as real font files, with no Google Fonts reference", () => {
    expect(files.some((f) => /rubik.*\.woff2$/.test(f.fileName))).toBe(true);
    const text = files.filter((f) => /\.(css|js|html)$/.test(f.fileName)).map((f) => String(f.type === "chunk" ? f.code : f.source));
    expect(text.some((t) => t.includes("googleapis"))).toBe(false);
    expect(text.some((t) => /url\(data:font/.test(t))).toBe(false);
  });

  it("declares the layer order with legacy between base and components", () => {
    expect(css).toMatch(/@layer theme,\s*base,\s*legacy,\s*components,\s*utilities;/);
    // the statement must come first so no layer is ordered implicitly before it
    expect(css.search(/@layer theme,\s*base,\s*legacy/)).toBeLessThan(css.indexOf("@layer legacy{"));
  });

  it("keeps every legacy rule inside @layer legacy; only SweetAlert and token rules are unlayered", () => {
    const blocks = topLevel(css);
    const unlayered = blocks.filter((b) => b.body && !b.head.startsWith("@layer") && !b.head.startsWith("@media") && !b.head.startsWith("@font-face") && !b.head.startsWith("@property") && !b.head.startsWith("@keyframes") && !b.head.startsWith("@supports"));
    for (const b of unlayered) {
      const sel = b.head;
      // legacy global selectors must not appear outside a layer
      expect(sel, sel).not.toMatch(/^(body|html|button|input|select|textarea|th|td|h1|h2|label|table|a)\b/);
      expect(sel, sel).not.toMatch(/^(\.btn|\.card|\.badge|\.navbar|\.modal)\b/);
    }
    const legacy = blocks.find((b) => b.head === "@layer legacy");
    expect(legacy).toBeDefined();
    expect(legacy!.body).toMatch(/\.btn/);
    expect(legacy!.body).toMatch(/body\{[^}]*font:/);
    // swal rules stay unlayered so they beat sweetalert2's own unlayered CSS
    expect(unlayered.some((b) => b.head.includes(".swal-popup"))).toBe(true);
  });

  it("applies Rubik to the body and keeps button variants as utilities in a later layer", () => {
    // base layer: body uses the Rubik stack
    expect(css).toMatch(/body\{[^}]*font-family:\s*var\(--font-sans\)/);
    // the legacy body font shorthand resolves to Rubik as well (and sits in a lower layer)
    expect(css).toMatch(/--font:\s*"Rubik Variable"/);
    const blocks = topLevel(css);
    expect(blocks.find((b) => b.head === "@layer utilities")!.body).toContain(".bg-primary");
  });
});
