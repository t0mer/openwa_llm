import { useLayoutEffect, useState } from "react";

/**
 * Tracks an element's width with a ResizeObserver. Returns a callback ref (not a mount-time effect)
 * so it follows the element when it unmounts and remounts, as it does when a ChartCard toggles to
 * its table and back. The fallback is used only while the element reports no layout width (0).
 */
export function useWidth(fallback = 640) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);
  // Layout effect: measure before the browser paints, so the fallback never flashes at narrow widths.
  useLayoutEffect(() => {
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    update();
    if (typeof ResizeObserver === "undefined") return; // measured once; no live resizing
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}
