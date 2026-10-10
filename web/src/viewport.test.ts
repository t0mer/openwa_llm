// @vitest-environment node
import { describe, expect, it } from "vitest";
import html from "../index.html?raw";

describe("index.html", () => {
  it("opts into the full screen so env(safe-area-inset-*) works on iOS", () => {
    const meta = /<meta name="viewport" content="([^"]*)"/.exec(html);
    expect(meta?.[1]).toContain("viewport-fit=cover");
    expect(meta?.[1]).toContain("width=device-width");
  });
});
