import { MessagesSquare } from "lucide-react";
import { cn } from "../../lib/cn";
import { APP_NAME } from "../ui/page-header";

/** Our mark and name. `iconOnly` keeps the name for screen readers. */
export function Brand({ iconOnly = false, className }: { iconOnly?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <MessagesSquare aria-hidden="true" className="size-6 shrink-0 text-primary" />
      <strong className={cn("text-lg font-semibold tracking-tight", iconOnly && "sr-only")}>{APP_NAME}</strong>
    </div>
  );
}
