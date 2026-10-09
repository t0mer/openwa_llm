import { useCallback, useSyncExternalStore } from "react";

/** Tracks a CSS media query. Without matchMedia (old browsers, some test runners) it is false. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia?.(query);
      if (!mql) return () => {};
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    [query],
  );
  const snapshot = useCallback(() => window.matchMedia?.(query).matches ?? false, [query]);
  return useSyncExternalStore(subscribe, snapshot, () => false);
}

/** Tailwind's md breakpoint: sidebar from here up, header + tab bar below. */
export const MD_QUERY = "(min-width: 768px)";
/** Tailwind's lg breakpoint: the sidebar shows labels from here up, icons only below. */
export const LG_QUERY = "(min-width: 1024px)";
