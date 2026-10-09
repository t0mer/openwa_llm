import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

/** A failure announced in place (role=alert), never colour alone: it carries its message. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn("rounded-md bg-danger-soft p-3 text-sm text-danger", className)}>
      {children}
    </p>
  );
}
