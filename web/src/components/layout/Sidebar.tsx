import { NavLink } from "react-router-dom";
import { LG_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { cn } from "../../lib/cn";
import { AccountMenu } from "./AccountMenu";
import { Brand } from "./Brand";
import { NAV_ITEMS } from "./nav";

/** Desktop navigation: full width from lg, icon-only (labels in aria-label/title) from md. */
export function Sidebar() {
  const wide = useMediaQuery(LG_QUERY);
  return (
    <aside
      className={cn(
        "sticky top-0 flex h-dvh shrink-0 flex-col gap-4 border-e border-border bg-surface px-2 py-4",
        wide ? "w-60" : "w-16",
      )}
    >
      <Brand iconOnly={!wide} className={cn("px-2", !wide && "justify-center px-0")} />
      <nav aria-label="Main" className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            aria-label={wide ? undefined : label}
            title={wide ? undefined : label}
            className={({ isActive }) =>
              cn(
                "relative flex min-h-10 items-center gap-3 rounded-md px-3 text-sm font-medium",
                !wide && "justify-center px-0",
                isActive
                  ? "bg-primary-soft text-primary before:absolute before:inset-y-2 before:start-0 before:w-1 before:rounded-full before:bg-primary"
                  : "text-muted-foreground hover:bg-surface-2 hover:text-foreground",
              )
            }
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            {wide && label}
          </NavLink>
        ))}
      </nav>
      <AccountMenu compact={!wide} />
    </aside>
  );
}
