export type ThemeMode = "light" | "dark" | "system";
export const THEME_KEY = "admin-theme";
const QUERY = "(prefers-color-scheme: dark)";

let unwatch: (() => void) | null = null;

/** The stored choice; absent or unreadable storage means "system". */
export function getThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark") return v;
  } catch {
    /* storage can be blocked (private windows) */
  }
  return "system";
}

function systemPrefersDark(): boolean {
  return window.matchMedia?.(QUERY).matches ?? false;
}

/** Resolve a mode to the concrete theme currently shown. */
export function resolveTheme(mode: ThemeMode = getThemeMode()): "light" | "dark" {
  return mode === "dark" || (mode === "system" && systemPrefersDark()) ? "dark" : "light";
}

function paint(mode: ThemeMode): void {
  const theme = resolveTheme(mode);
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  // Legacy hook for the not-yet-migrated stylesheet; removed together with styles.css.
  root.setAttribute("data-theme", theme);
}

/**
 * Apply a mode to <html> (class `dark`) without persisting it. While the mode is "system" the
 * page follows OS changes live; any other mode stops following.
 */
export function applyTheme(mode: ThemeMode = getThemeMode()): void {
  unwatch?.();
  unwatch = null;
  paint(mode);
  if (mode === "system") {
    const mql = window.matchMedia?.(QUERY);
    if (mql?.addEventListener) {
      const onChange = () => paint("system");
      mql.addEventListener("change", onChange);
      unwatch = () => mql.removeEventListener("change", onChange);
    }
  }
}

/** Persist and apply a mode ("system" clears the stored choice). */
export function setThemeMode(mode: ThemeMode): void {
  try {
    if (mode === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, mode);
  } catch {
    /* the choice still applies for this page view */
  }
  applyTheme(mode);
}

/** True while the page is dark (read from the DOM, so it follows the toggle and the OS). */
export function isDark(): boolean {
  return document.documentElement.classList.contains("dark");
}
