import { Ellipsis } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { cn } from "../../lib/cn";
import { MoreSheet } from "./MoreSheet";
import { NAV_ITEMS } from "./nav";

const tab = "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-medium";

/** Fixed bottom navigation on phones: the primary pages plus a More tab. */
export function TabBar() {
  const { pathname } = useLocation();
  const secondaryActive = NAV_ITEMS.some((i) => !i.primary && pathname.startsWith(i.to));
  return (
    <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
      {NAV_ITEMS.filter((i) => i.primary).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) => cn(tab, isActive ? "text-primary" : "text-muted-foreground")}
        >
          <Icon aria-hidden="true" className="size-6" />
          {label}
        </NavLink>
      ))}
      <MoreSheet
        trigger={
          <button type="button" className={cn(tab, secondaryActive ? "text-primary" : "text-muted-foreground")}>
            <Ellipsis aria-hidden="true" className="size-6" />
            More
          </button>
        }
      />
    </nav>
  );
}
