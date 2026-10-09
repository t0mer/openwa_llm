import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useMediaQuery } from "./useMediaQuery";

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
