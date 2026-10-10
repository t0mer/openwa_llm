import { describe, expect, it } from "vitest";
import { parseRangeParams, rangeToParams, resolveRange } from "./dateRange";

const NOW = new Date(2026, 9, 10, 15, 30, 0); // local

describe("resolveRange presets", () => {
  it.each([
    ["24h", 24 * 3600e3],
    ["7d", 7 * 86400e3],
    ["30d", 30 * 86400e3],
    ["90d", 90 * 86400e3],
  ] as const)("%s ends now and starts that long before", (key, ms) => {
    expect(resolveRange(key, NOW)).toEqual({
      from: new Date(NOW.getTime() - ms).toISOString(),
      to: NOW.toISOString(),
    });
  });

  it("all has no bounds", () => {
    expect(resolveRange("all", NOW)).toEqual({});
  });
});

describe("resolveRange custom", () => {
  it("starts at local midnight and includes the whole end day", () => {
    const r = resolveRange("custom", NOW, { from: "2026-10-01", to: "2026-10-03" });
    expect(r).toEqual({
      from: new Date(2026, 9, 1, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 9, 3, 23, 59, 59, 999).toISOString(),
    });
  });

  it("accepts a single-day range", () => {
    const r = resolveRange("custom", NOW, { from: "2026-10-03", to: "2026-10-03" });
    expect(r).not.toHaveProperty("error");
  });

  it("rejects reversed, missing and malformed dates", () => {
    expect(resolveRange("custom", NOW, { from: "2026-10-05", to: "2026-10-01" })).toHaveProperty("error");
    expect(resolveRange("custom", NOW)).toHaveProperty("error");
    expect(resolveRange("custom", NOW, { from: "nope", to: "2026-10-01" })).toHaveProperty("error");
    expect(resolveRange("custom", NOW, { from: "2026-02-31", to: "2026-03-05" })).toHaveProperty("error");
  });
});

describe("URL params", () => {
  it("defaults to 7d when empty or invalid", () => {
    expect(parseRangeParams(new URLSearchParams())).toEqual({ key: "7d" });
    expect(parseRangeParams(new URLSearchParams("range=bogus"))).toEqual({ key: "7d" });
    expect(parseRangeParams(new URLSearchParams("range=custom"))).toEqual({ key: "7d" });
    expect(parseRangeParams(new URLSearchParams("range=custom&from=2026-13-01&to=2026-10-01"))).toEqual({ key: "7d" });
  });

  it("falls back to 7d for a reversed custom range in the URL", () => {
    expect(parseRangeParams(new URLSearchParams("range=custom&from=2026-10-05&to=2026-10-01"))).toEqual({ key: "7d" });
  });

  it("does not serialise a reversed custom range", () => {
    expect(rangeToParams("custom", { from: "2026-10-05", to: "2026-10-01" }).toString()).toBe("range=7d");
  });

  it.each(["24h", "7d", "30d", "90d", "all"] as const)("round-trips %s", (key) => {
    expect(parseRangeParams(rangeToParams(key))).toEqual({ key });
  });

  it("round-trips a custom range", () => {
    const custom = { from: "2026-10-01", to: "2026-10-03" };
    const sp = rangeToParams("custom", custom);
    expect(sp.toString()).toBe("range=custom&from=2026-10-01&to=2026-10-03");
    expect(parseRangeParams(sp)).toEqual({ key: "custom", custom });
  });

  it("rangeToParams falls back to 7d for an unusable custom range", () => {
    expect(rangeToParams("custom").toString()).toBe("range=7d");
    expect(rangeToParams("custom", { from: "x", to: "y" }).toString()).toBe("range=7d");
  });
});

describe("date edges", () => {
  it("keeps the last day's local end across a DST change (no +24h arithmetic)", () => {
    const r = resolveRange("custom", NOW, { from: "2026-03-28", to: "2026-03-30" });
    expect(r).toEqual({
      from: new Date(2026, 2, 28, 0, 0, 0, 0).toISOString(),
      to: new Date(2026, 2, 30, 23, 59, 59, 999).toISOString(),
    });
    const end = new Date((r as { to: string }).to);
    expect([end.getDate(), end.getHours(), end.getMinutes(), end.getSeconds(), end.getMilliseconds()]).toEqual([30, 23, 59, 59, 999]);
  });

  it("accepts a leap day only in a leap year", () => {
    expect(resolveRange("custom", NOW, { from: "2028-02-29", to: "2028-02-29" })).not.toHaveProperty("error");
    expect(resolveRange("custom", NOW, { from: "2026-02-29", to: "2026-03-01" })).toHaveProperty("error");
  });

  it("rejects years before 1000", () => {
    expect(resolveRange("custom", NOW, { from: "0099-01-01", to: "2026-01-01" })).toHaveProperty("error");
    expect(parseRangeParams(new URLSearchParams("range=custom&from=0099-01-01&to=2026-01-01"))).toEqual({ key: "7d" });
  });
});
