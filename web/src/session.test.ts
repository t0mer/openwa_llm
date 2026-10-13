import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SESSION_KEY, getSessionId, setSessionId, useSessionId } from "./session";

beforeEach(() => {
  localStorage.clear();
  setSessionId(null);
});
afterEach(() => vi.restoreAllMocks());

describe("session selection", () => {
  it("stores the selection and persists it", () => {
    setSessionId("abc");
    expect(getSessionId()).toBe("abc");
    expect(localStorage.getItem(SESSION_KEY)).toBe("abc");
    setSessionId(null);
    expect(getSessionId()).toBeNull();
    expect(localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  it("keeps working when storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => setSessionId("x")).not.toThrow();
    expect(getSessionId()).toBe("x");
    expect(() => setSessionId(null)).not.toThrow();
    expect(getSessionId()).toBeNull();
  });

  it("re-renders subscribers when the selection changes", () => {
    const { result } = renderHook(() => useSessionId());
    expect(result.current).toBeNull();
    act(() => setSessionId("s1"));
    expect(result.current).toBe("s1");
  });
});
