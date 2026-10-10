import "@testing-library/jest-dom/vitest";

// Pin the browser time zone so date tests mean the same on every machine (UTC is not the
// dashboard's server zone, so server-zone formatting is distinguishable from browser-zone).
process.env.TZ = "UTC";

// jsdom lacks these browser APIs, which Radix primitives (Switch, Dropdown, Dialog) rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof Element !== "undefined") {
  globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
  Element.prototype.hasPointerCapture ??= () => false;
  Element.prototype.setPointerCapture ??= () => {};
  Element.prototype.releasePointerCapture ??= () => {};
  Element.prototype.scrollIntoView ??= () => {};
}
