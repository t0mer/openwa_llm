import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useRef, type ComponentPropsWithoutRef, type ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Button } from "./button";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

const overlay = "fixed inset-0 z-50 bg-[#14122b]/60 backdrop-blur-[2px]";

type ContentProps = Omit<ComponentPropsWithoutRef<typeof DialogPrimitive.Content>, "title">;

/** SweetAlert2 renders its popups and toasts into this container, appended to <body>. */
const SWAL_CONTAINER = ".swal2-container";
const inSwal = (target: EventTarget | null) => target instanceof Element && !!target.closest(SWAL_CONTAINER);
/** A SweetAlert modal (not a toast) is showing over the dialog. */
export const swalModalOpen = () => !!document.querySelector(".swal2-popup:not(.swal2-toast)");

/** The SweetAlert container holding a modal popup (not a toast) that `node` is inside, if any. */
const inSwalModal = (node: EventTarget | null) =>
  node instanceof Element && !!node.closest(SWAL_CONTAINER)?.querySelector(".swal2-popup:not(.swal2-toast)");

/**
 * Radix traps focus with focusin/focusout listeners on `document`. A SweetAlert confirm opened from
 * the dialog lives outside it (appended to <body>) and focuses itself synchronously, so the trap
 * would pull focus straight back into the dialog. Focus moves into a SweetAlert modal stop at
 * <body>: React's handlers (on the portal root) still run, Radix's document-level trap does not.
 */
function SwalFocusPassThrough() {
  useEffect(() => {
    const onFocusIn = (e: FocusEvent) => {
      if (inSwalModal(e.target)) e.stopPropagation();
    };
    const onFocusOut = (e: FocusEvent) => {
      if (inSwalModal(e.relatedTarget)) e.stopPropagation();
    };
    document.body.addEventListener("focusin", onFocusIn);
    document.body.addEventListener("focusout", onFocusOut);
    return () => {
      document.body.removeEventListener("focusin", onFocusIn);
      document.body.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return null;
}

/** How many open dialogs made each element inert; only elements we made inert are released. */
const inertCount = new Map<Element, number>();

/**
 * Marks every other child of <body> (the app root, earlier dialogs' portals) `inert` while the
 * dialog is open. Radix only adds aria-hidden and a focus trap; when the focused button becomes
 * disabled browsers move focus to <body>, and Tab could then reach the page. SweetAlert
 * containers stay interactive (excluded here, and any created later are not marked). Reference
 * counted, so stacked dialogs and StrictMode's double effects never leave a stray `inert`.
 */
function InertOutside() {
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const own = marker.current?.closest("[role=dialog]");
    if (!own) return;
    const marked: Element[] = [];
    for (const el of Array.from(document.body.children)) {
      if (el.contains(own) || el.matches(`${SWAL_CONTAINER}, [data-radix-focus-guard], [data-dialog-overlay]`)) continue;
      const count = inertCount.get(el);
      if (count === undefined && el.hasAttribute("inert")) continue; // inert for another reason
      inertCount.set(el, (count ?? 0) + 1);
      el.setAttribute("inert", "");
      marked.push(el);
    }
    return () => {
      for (const el of marked) {
        const count = (inertCount.get(el) ?? 1) - 1;
        if (count > 0) inertCount.set(el, count);
        else {
          inertCount.delete(el);
          el.removeAttribute("inert");
        }
      }
    };
  }, []);
  return <span ref={marker} hidden />;
}

/**
 * A bottom sheet on phones, a centred dialog from md. `wide` widens it (Schedules). Extra Radix
 * Content props pass through. `closeDisabled` (use while saving) disables the close button and
 * blocks Escape and outside clicks, after any caller handlers have run.
 *
 * SweetAlert2 popups opened over the dialog keep working: they may take focus, clicks inside them
 * are not "outside" clicks, and Escape while a SweetAlert modal is open closes only that modal.
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
  title: ReactNode;
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
          if (closeDisabled || swalModalOpen()) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          onPointerDownOutside?.(e);
          if (closeDisabled || inSwal(e.target)) e.preventDefault();
        }}
        onInteractOutside={(e) => {
          onInteractOutside?.(e);
          if (closeDisabled || inSwal(e.target)) e.preventDefault();
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
        <SwalFocusPassThrough />
        <InertOutside />
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
