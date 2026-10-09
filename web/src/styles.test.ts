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
});
