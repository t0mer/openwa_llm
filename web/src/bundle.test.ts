// @vitest-environment node
import { describe, expect, it } from "vitest";
import { build } from "vite";

describe("production bundle", () => {
  it("emits Rubik as real font files, with no Google Fonts reference", async () => {
    const result = (await build({
      configFile: "vite.config.ts",
      logLevel: "silent",
      build: { write: false, emptyOutDir: false },
    })) as { output: { fileName: string; type: string; source?: string | Uint8Array; code?: string }[] };
    const files = Array.isArray(result) ? (result as unknown as typeof result[]).flatMap((r) => r.output) : result.output;
    const names = files.map((f) => f.fileName);
    expect(names.some((n) => /rubik.*\.woff2$/.test(n))).toBe(true);
    const text = files
      .filter((f) => /\.(css|js|html)$/.test(f.fileName))
      .map((f) => String(f.type === "chunk" ? f.code : f.source));
    expect(text.some((t) => t.includes("googleapis"))).toBe(false);
    expect(text.some((t) => /url\(data:font/.test(t))).toBe(false);
  }, 60_000);
});
