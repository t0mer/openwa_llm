import { LogOut } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../../auth";
import { THEME_OPTIONS, useThemeMode } from "../../hooks/useThemeMode";
import { cn } from "../../lib/cn";
import { Button } from "../ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "../ui/dialog";
import { NAV_ITEMS } from "./nav";

/** The phone "More" tab: secondary pages, theme and log out in a bottom sheet. */
export function MoreSheet({ trigger }: { trigger: ReactNode }) {
  const { logout } = useAuth();
  const [mode, setMode] = useThemeMode();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => setOpen(false), [pathname]);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        title="More"
        // A SweetAlert popup owns Escape while it is open (toasts do not).
        onEscapeKeyDown={(e) => {
          if (document.querySelector(".swal2-popup:not(.swal2-toast)")) e.preventDefault();
        }}
      >
        <div className="flex flex-col gap-1">
          {NAV_ITEMS.filter((i) => !i.primary).map(({ to, label, icon: Icon }) => (
            // DialogClose closes the sheet even when the link points at the current page.
            <DialogClose asChild key={to}>
              <NavLink
                to={to}
                className={({ isActive }) =>
                  cn(
                    "flex min-h-11 items-center gap-3 rounded-md px-3 text-sm font-medium",
                    isActive ? "bg-primary-soft text-primary" : "text-foreground hover:bg-surface-2",
                  )
                }
              >
                <Icon aria-hidden="true" className="size-5" />
                {label}
              </NavLink>
            </DialogClose>
          ))}
        </div>
        <div role="group" aria-label="Theme" className="flex flex-col gap-2">
          <p className="text-sm font-medium text-muted-foreground">Theme</p>
          <div className="grid grid-cols-3 gap-2">
            {THEME_OPTIONS.map(({ mode: m, label, icon: Icon }) => (
              <Button
                key={m}
                variant={mode === m ? "secondary" : "outline"}
                aria-pressed={mode === m}
                className={cn(mode === m && "border border-primary text-primary")}
                onClick={() => setMode(m)}
              >
                <Icon aria-hidden="true" />
                {label}
              </Button>
            ))}
          </div>
        </div>
        <Button variant="outline" onClick={() => void logout()}>
          <LogOut aria-hidden="true" />
          Log out
        </Button>
      </DialogContent>
    </Dialog>
  );
}
