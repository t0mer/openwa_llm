import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useErrorToast } from "./useLoad";

vi.mock("./alerts");
import { toast } from "./alerts";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => vi.useRealTimers());

describe("useErrorToast", () => {
  it("toasts a repeating message once per minute, and distinct messages immediately", () => {
    const { rerender } = renderHook(({ e }: { e: string | null }) => useErrorToast(e), { initialProps: { e: "flaky-1" as string | null } });
    expect(toast.error).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      rerender({ e: null });
      rerender({ e: "flaky-1" });
    }
    expect(toast.error).toHaveBeenCalledTimes(1);
    rerender({ e: "other" });
    expect(toast.error).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(61_000);
    rerender({ e: null });
    rerender({ e: "flaky-1" });
    expect(toast.error).toHaveBeenCalledTimes(3);
  });

  it("prunes expired entries from the dedupe map", () => {
    // After the window, a repeat toasts again (entry was expired and replaced), proving old state is not kept forever.
    const { rerender } = renderHook(({ e }: { e: string | null }) => useErrorToast(e), { initialProps: { e: "old" as string | null } });
    vi.advanceTimersByTime(61_000);
    rerender({ e: "new" });
    rerender({ e: "old" });
    expect(toast.error).toHaveBeenCalledTimes(3);
  });
});
