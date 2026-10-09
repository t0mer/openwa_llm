import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay = "fixed inset-0 z-50 bg-[#14122b]/60 backdrop-blur-[2px]";

type ContentProps = Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title">;

/**
 * A bottom sheet on phones, a centred dialog from md. `wide` widens it (Schedules). Extra Radix
 * Content props pass through. `closeDisabled` (use while saving) disables the close button and
 * blocks Escape and outside clicks, after any caller handlers have run.
 */
export function DialogContent({
  title,
  description,
  children,
  className,
  wide = false,
  closeDisabled = false,
  onEscapeKeyDown,
  onPointerDownOutside,
  onInteractOutside,
  ...props
}: ContentProps & {
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  closeDisabled?: boolean;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay data-dialog-overlay="" className={overlay} />
      <DialogPrimitive.Content
        {...(description ? {} : { "aria-describedby": undefined })}
        aria-modal="true"
        {...props}
        // Caller handlers run first; closeDisabled then still blocks every way of closing.
        onEscapeKeyDown={(e) => {
          onEscapeKeyDown?.(e);
          if (closeDisabled) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          onPointerDownOutside?.(e);
          if (closeDisabled) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e);
          if (closeDisabled) e.preventDefault();
        }}
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col gap-4 overflow-y-auto rounded-t-xl border border-border bg-surface p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-overlay",
          "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-full md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-lg",
          wide ? "md:max-w-3xl" : "md:max-w-md",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            {description && (
              <DialogPrimitive.Description className="text-sm text-muted-foreground">
                {description}
              </DialogPrimitive.Description>
            )}
          </div>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" size="icon" aria-label="Close" disabled={closeDisabled} className="-me-2 -mt-2">
              <X />
            </Button>
          </DialogPrimitive.Close>
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
