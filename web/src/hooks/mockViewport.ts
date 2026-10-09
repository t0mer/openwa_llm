import { vi } from "vitest";

/** Stub window.matchMedia for a viewport width (supports min-width / max-width queries and prefers-color-scheme). */
export function mockViewport(width: number, opts: { dark?: boolean } = {}) {
  const match = (q: string) => {
    const min = /min-width:\s*(\d+)px/.exec(q);
    const max = /max-width:\s*(\d+)px/.exec(q);
    if (q.includes("prefers-color-scheme")) return q.includes("dark") === !!opts.dark;
    return (!min || width >= +min[1]) && (!max || width <= +max[1]);
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn((q: string) => ({
      matches: match(q),
      media: q,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    })),
  );
}
