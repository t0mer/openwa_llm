import { ChevronDown } from "lucide-react";
import {
  cloneElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { cn } from "../../lib/cn";

const control =
  "min-h-11 min-w-0 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base md:text-sm text-foreground placeholder:text-muted-foreground disabled:opacity-60";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, className)} {...props} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, "min-h-24", className)} {...props} />;
}

/** A native select: phones get the operating system's own picker. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className="relative block">
      <select className={cn(control, "appearance-none pe-9", className)} {...props}>
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute end-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
      />
    </span>
  );
}

/**
 * A labelled control. The <label> holds only the label text (so it is the whole accessible name)
 * and points at the control by id; the hint sits outside it and is linked with aria-describedby.
 * The control must accept `id` and `aria-describedby` (Input, Select and Textarea do).
 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactElement<{ id?: string; "aria-describedby"?: string }>;
  className?: string;
}) {
  const auto = useId();
  const id = children.props.id ?? auto;
  const hintId = `${id}-hint`;
  const describedBy = [children.props["aria-describedby"], hint ? hintId : undefined].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5 text-sm font-medium", className)}>
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, { id, "aria-describedby": describedBy })}
      {hint && (
        <span id={hintId} className="text-xs font-normal text-muted-foreground">
          {hint}
        </span>
      )}
    </div>
  );
}
