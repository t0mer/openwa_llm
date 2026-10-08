import { useId, useState, type KeyboardEvent } from "react";

interface Props {
  value: string[];
  onChange: (tags: string[]) => void;
  label?: string;
}

export default function TagInput({ value, onChange, label = "Tags" }: Props) {
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
    <div className="tags">
      {value.map((tag) => (
        <span className="tag" key={tag}>
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        aria-label={label}
        value={text}
        onChange={(e) => onText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => text.trim() && commit(text)}
      />
    </div>
  );
}
