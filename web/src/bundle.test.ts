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

type Node = { head: string; children?: Node[]; body: string };

/** Parse minified CSS into a tree: statements ("@layer a,b;") have no children, blocks do. */
function parse(raw: string): Node[] {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  let i = 0;
  function list(): Node[] {
    const out: Node[] = [];
    for (;;) {
      let head = "";
      while (i < src.length && src[i] !== "{" && src[i] !== "}" && src[i] !== ";") head += src[i++];
      head = head.trim();
      const ch = src[i++];
      if (ch === undefined || ch === "}") return out;
      if (ch === ";") {
        if (head) out.push({ head, body: "" });
        continue;
      }
      // block: decide whether it holds rules (at-rule containers) or declarations
      const startBody = i;
      if (/^@(layer|media|supports|container)\b/.test(head)) {
        out.push({ head, children: list(), body: "" });
      } else {
        let depth = 1;
        while (i < src.length && depth > 0) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0, i++;
        out.push({ head, body: src.slice(startBody, i - 1) });
      }
    }
  }
  return list();
}

const LAYERS = ["theme", "base", "components", "utilities"];

/** Layer names in the order the browser first meets them (statements and blocks, in document order). */
function layerFirstMention(nodes: Node[], seen: string[] = []): string[] {
  for (const n of nodes) {
    const m = /^@layer\s+([^{]*)$/.exec(n.head);
    if (m) for (const name of m[1].split(",").map((x) => x.trim())) if (name && !seen.includes(name)) seen.push(name);
    if (n.children) layerFirstMention(n.children, seen);
  }
  return seen;
}

const ALLOWED_RULE = /^(:root(\.dark)?|:host|\.swal-[\w-]+|\.swal2-[\w-]+|\.tabular)\b/;
const ALLOWED_AT = /^@(property|font-face|keyframes)\b/;

/** Return the offending selector of the first unlayered rule that is not on the allowlist. */
function unlayeredViolations(nodes: Node[], out: string[] = []): string[] {
  for (const n of nodes) {
    if (/^@layer\b/.test(n.head)) continue; // layer statements and layer blocks
    if (ALLOWED_AT.test(n.head)) continue;
    if (n.children) {
      unlayeredViolations(n.children, out); // @media / @supports: contents must be allowed too
      continue;
    }
    // selector lists may be comma separated; each part must be allowed
    for (const sel of n.head.split(",").map((x) => x.trim())) if (!ALLOWED_RULE.test(sel)) out.push(sel);
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

  it("the effective cascade order is theme < base < components < utilities, with no legacy layer", () => {
    const seen = layerFirstMention(parse(css));
    const pos = LAYERS.map((l) => seen.indexOf(l));
    expect(pos.every((p) => p >= 0), `layers seen: ${seen.join(",")}`).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
    expect(seen).not.toContain("legacy");
  });

  it("every unlayered rule is on the allowlist (tokens, @property/@font-face/@keyframes, SweetAlert)", () => {
    const tree = parse(css);
    expect(unlayeredViolations(tree)).toEqual([]);
    // swal rules stay unlayered so they beat sweetalert2's own unlayered CSS
    expect(tree.some((n) => n.head.includes(".swal-popup"))).toBe(true);
    // the Bot actions results list is styled by unlayered swal rules too
    for (const sel of [".swal-results", ".swal-result", ".swal-result-badge-sent", ".swal-result-badge-failed", ".swal-result-badge-skipped", ".swal-result-detail"]) {
      expect(tree.some((n) => !n.children && n.head.split(",").map((x) => x.trim()).includes(sel)), sel).toBe(true);
    }
  });

  it("provides the .jid bidi utility (left-to-right isolate) in the components layer", () => {
    const tree = parse(css);
    const layers = tree.filter((n) => n.head === "@layer components" && n.children).flatMap((n) => n.children!);
    const jid = layers.filter((n) => n.head.split(",").map((x) => x.trim()).includes(".jid"));
    const decls = jid.flatMap((r) => r.body.split(";").map((d) => d.trim().replace(/\s+/g, "")));
    expect(decls).toContain("direction:ltr");
    expect(decls).toContain("unicode-bidi:isolate");
  });

  it("body text is Rubik: base-layer body uses --font-sans, which is the Rubik Variable stack", () => {
    const tree = parse(css);
    const base = tree.filter((n) => n.head === "@layer base" && n.children).flatMap((n) => n.children!);
    const body = base.find((n) => n.head === "body")!;
    expect(body.body).toMatch(/font-family:\s*var\(--font-sans\)/);
    expect(body.body).toMatch(/font-size:\s*15px/);
    expect(css).toMatch(/--font-sans:\s*"Rubik Variable"/);
    // nothing unlayered may re-set the body font
    expect(tree.filter((n) => !n.children && /^(body|html)\b/.test(n.head))).toEqual([]);
    expect(css).toMatch(/@font-face\{font-family:Rubik Variable/);
  });

  it("legacy styles.css rules are gone from the bundle", () => {
    for (const legacy of ["table.responsive", ".cell-actions", ".modal-backdrop", "--accent", "--s4", "button.burger"]) {
      expect(css, legacy).not.toContain(legacy);
    }
  });

  it("modal SweetAlert containers take pointer input over a Radix modal (body has pointer-events:none)", () => {
    const tree = parse(css);
    // an unlayered rule for exactly `.swal2-container` (one class), so SweetAlert's own
    // `body.swal2-toast-shown .swal2-container { pointer-events: none }` still wins for toasts
    const rules = tree.filter((n) => !n.children && n.head.split(",").map((x) => x.trim()).includes(".swal2-container"));
    const decls = rules.flatMap((r) => r.body.split(";").map((d) => d.trim().replace(/\s+/g, "")));
    expect(decls).toContain("pointer-events:auto");
  });
});

