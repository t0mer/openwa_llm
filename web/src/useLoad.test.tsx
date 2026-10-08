import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { useLoad } from "./useLoad";

afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("useLoad", () => {
  it("ignores a slow stale response that resolves after a newer one", async () => {
    const slow = deferred<string>();
    const load = vi.fn((q: string) => (q === "a" ? slow.promise : Promise.resolve("B")));
    const { result, rerender } = renderHook(({ q }) => useLoad(() => load(q), [q]), {
      initialProps: { q: "a" },
    });
    rerender({ q: "b" });
    await waitFor(() => expect(result.current.data).toBe("B"));
    await act(async () => slow.resolve("A"));
    expect(result.current.data).toBe("B");
    expect(result.current.loading).toBe(false);
  });

  it("re-runs the loader on the interval", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValue("x");
    renderHook(() => useLoad(load, []));
    await act(async () => {});
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("stops loading on unmount and drops a late response", async () => {
    vi.useFakeTimers();
    const late = deferred<string>();
    const load = vi.fn().mockReturnValue(late.promise);
    const { result, unmount } = renderHook(() => useLoad(load, []));
    await act(async () => {});
    unmount();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(load).toHaveBeenCalledTimes(1);
    await act(async () => late.resolve("late"));
    expect(result.current.data).toBeNull();
  });

  it("keeps old data and sets error when a reload fails", async () => {
    const load = vi.fn().mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useLoad(load, []));
    await waitFor(() => expect(result.current.data).toBe("ok"));
    await act(async () => {
      await result.current.reload();
    });
    expect(result.current.data).toBe("ok");
    expect(result.current.error).toBe("boom");
  });

  it("does not set an error for a 401", async () => {
    const load = vi.fn().mockRejectedValue(new ApiError(401, "not authenticated"));
    const { result } = renderHook(() => useLoad(load, []));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});
