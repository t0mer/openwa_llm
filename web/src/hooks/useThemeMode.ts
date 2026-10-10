import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { getThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";

export const THEME_OPTIONS: { mode: ThemeMode; label: string; icon: LucideIcon }[] = [
  { mode: "system", label: "System", icon: Monitor },
  { mode: "light", label: "Light", icon: Sun },
  { mode: "dark", label: "Dark", icon: Moon },
];

/** The stored theme choice plus a setter that persists and applies it. */
export function useThemeMode(): [ThemeMode, (mode: ThemeMode) => void] {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode);
  return [
    mode,
    (next) => {
      setThemeMode(next);
      setMode(next);
    },
  ];
}
