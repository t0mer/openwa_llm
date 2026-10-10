import { ChevronsUpDown, LogOut, User } from "lucide-react";
import { useAuth } from "../../auth";
import { THEME_OPTIONS, useThemeMode } from "../../hooks/useThemeMode";
import type { ThemeMode } from "../../lib/theme";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/dropdown";

/** Theme choice and log out, opened from the sidebar footer. */
export function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { logout } = useAuth();
  const [mode, setMode] = useThemeMode();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        title={compact ? "Account" : undefined}
        className="flex min-h-10 w-full items-center gap-3 rounded-md px-2 text-sm font-medium text-foreground hover:bg-surface-2"
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
          <User aria-hidden="true" className="size-4" />
        </span>
        {!compact && (
          <>
            <span className="flex-1 truncate text-start">Account</span>
            <ChevronsUpDown aria-hidden="true" className="size-4 text-muted-foreground" />
          </>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuLabel className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Theme</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(v) => setMode(v as ThemeMode)}>
          {THEME_OPTIONS.map(({ mode: m, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={m} value={m}>
              <Icon aria-hidden="true" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
