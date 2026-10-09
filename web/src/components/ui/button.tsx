import { Slot } from "@radix-ui/react-slot";
import { type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef, MouseEvent } from "react";
import { cn } from "../../lib/cn";
import { buttonVariants } from "./button-variants";

export interface ButtonProps extends ComponentPropsWithRef<"button">, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

/**
 * With `asChild` the child (e.g. an <a>) is rendered instead of a <button>, so `type` is never
 * forwarded, and `disabled` (which links ignore) becomes aria-disabled + tabIndex -1 +
 * pointer-events-none, with clicks suppressed.
 */
export function Button({ className, variant, size, asChild, type, disabled, onClick, ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size }), className);
  if (!asChild) return <button className={classes} type={type ?? "button"} disabled={disabled} onClick={onClick} {...props} />;
  return (
    <Slot
      className={cn(classes, disabled && "pointer-events-none opacity-50")}
      {...(disabled ? { "aria-disabled": true, tabIndex: -1 } : {})}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (disabled) e.preventDefault();
        else onClick?.(e);
      }}
      {...props}
    />
  );
}
