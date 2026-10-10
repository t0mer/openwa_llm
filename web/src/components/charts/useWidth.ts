import { useEffect, useState } from "react";

/**
 * Tracks an element's width with a ResizeObserver. Returns a callback ref (not a mount-time effect)
 * so it follows the element when it unmounts and remounts, as it does when a ChartCard toggles to
 * its table and back. Until the element has a layout width the fallback is used.
 */
export function useWidth(fallback = 640) {
  const [el, setEl] = useState<HTMLElement | null>(null);
  const [width, setWidth] = useState(fallback);
  useEffect(() => {
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [el]);
  return [setEl, width] as const;
}
