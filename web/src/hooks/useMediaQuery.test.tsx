import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "./mockViewport";
import { LG_QUERY, MD_QUERY, useMediaQuery, XL_QUERY } from "./useMediaQuery";

afterEach(() => vi.unstubAllGlobals());

describe("useMediaQuery", () => {
  it("is false when matchMedia is unavailable", () => {
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useMediaQuery("(min-width: 768px)")).result.current).toBe(false);
  });

  it("follows change events", () => {
    let listener: () => void = () => {};
    let removeSpy: ReturnType<typeof vi.fn> = vi.fn();
    const mql = {
      matches: false,
      addEventListener: (_: string, l: () => void) => (listener = l),
      removeEventListener: vi.fn(),
    };
    removeSpy = mql.removeEventListener;
    vi.stubGlobal("matchMedia", vi.fn(() => mql));
    const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 768px)"));
    expect(result.current).toBe(false);
    mql.matches = true;
    act(() => listener());
    expect(result.current).toBe(true);
    expect(removeSpy).not.toHaveBeenCalled();
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("change", listener);
  });
});

describe("breakpoint queries", () => {
  it.each([
    [767, [false, false, false]],
    [768, [true, false, false]],
    [1023, [true, false, false]],
    [1024, [true, true, false]],
    [1279, [true, true, false]],
    [1280, [true, true, true]],
  ] as const)("at %ipx: md/lg/xl = %j", (width, expected) => {
    mockViewport(width);
    const got = [MD_QUERY, LG_QUERY, XL_QUERY].map((q) => renderHook(() => useMediaQuery(q)).result.current);
    expect(got).toEqual(expected);
  });
});
