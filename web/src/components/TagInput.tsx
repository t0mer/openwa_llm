import { useId, useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
  /** Id of a hint linked to the text box with aria-describedby. */
  describedBy?: string;
}

/** Free-form tags: Enter or comma adds the typed text, pasted comma lists are split, Backspace removes the last. */
export default function TagInput({ value, onChange, label = "Tags", describedBy }: Props) {
  const [text, setText] = useState("");
  const id = useId();

  function commitAll(parts: string[]) {
    setText("");
    const next = [...value];
    for (const part of parts) {
      const tag = part.trim();
      if (tag && !next.includes(tag)) next.push(tag);
    }
    if (next.length !== value.length) onChange(next);
  }

  function commit(raw: string) {
    commitAll([raw]);
  }

  function onText(raw: string) {
    if (raw.includes(",")) commitAll(raw.split(","));
    else setText(raw);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      commit(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2 py-1.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
      {value.map((tag) => (
        <span className="inline-flex items-center gap-0.5 rounded-sm bg-primary-soft ps-2 text-sm font-medium text-primary" key={tag}>
          <bdi dir="auto">{tag}</bdi>
          <button
            type="button"
            className="inline-flex size-7 items-center justify-center rounded-sm hover:bg-primary/10"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(value.filter((t) => t !== tag))}
          >
            <X aria-hidden="true" className="size-3.5" />
          </button>
        </span>
      ))}
      <input
        id={id}
        className="min-h-8 min-w-28 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted-foreground md:text-sm"
        aria-label={label}
        aria-describedby={describedBy}
        dir="auto"
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit(text)}
      />
    </div>
  );
}
