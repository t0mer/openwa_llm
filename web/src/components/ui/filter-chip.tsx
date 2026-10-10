import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

/** A toggle chip for filters; `active` is exposed to assistive tech through aria-pressed. */
export function FilterChip({
  active,
  className,
  type,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type={type ?? "button"}
      aria-pressed={active}
      className={cn(
        "min-h-11 lg:min-h-9 shrink-0 rounded-full border px-3.5 text-sm font-medium transition-colors",
        active
          ? "border-primary bg-primary-soft text-primary"
          : "border-border-strong text-muted-foreground hover:bg-surface-2",
        className,
      )}
      {...props}
    />
  );
}
