import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Stub window.matchMedia for a viewport width (min-width / max-width queries and prefers-color-scheme).
 * `setWidth` resizes and dispatches change events to the registered listeners inside act().
 * `listenerCount` is how many are currently registered.
 */
export function mockViewport(initial: number, opts: { dark?: boolean } = {}) {
  let width = initial;
  const entries = new Set<{ q: string; matches: boolean; fn: () => void }>();
  const match = (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    if (q.includes("prefers-color-scheme")) return q.includes("dark") === !!opts.dark;
    return (!min || width >= +min[1]) && (!max || width <= +max[1]);
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => {
      const mql = {
        get matches() {
          return match(q);
        },
        media: q,
        addEventListener: (_: string, fn: () => void) => entries.add({ q, matches: match(q), fn }),
        removeEventListener: (_: string, fn: () => void) => {
          for (const e of entries) if (e.fn === fn) entries.delete(e);
        },
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
        onchange: null,
      };
      return mql;
    }),
  );
  return {
    setWidth(next: number) {
      width = next;
      act(() => {
        for (const e of [...entries]) e.fn();
      });
    },
    listenerCount: () => entries.size,
  };
}
