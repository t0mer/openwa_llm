import { useId, useRef, useState, type FormEvent } from "react";
import TagInput from "./TagInput";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Field, Input, Select } from "./ui/field";
import { InlineError } from "./ui/inline-error";
import { useReturnFocus } from "./useReturnFocus";
import type { Group, GroupPatch, SummaryLanguage } from "../types";

export const LANGUAGES: { value: SummaryLanguage; label: string }[] = [
  { value: "he", label: "HE" },
  { value: "en", label: "EN" },
  { value: "ru", label: "RU" },
];

/** Select value ("" = Auto) to API value. */
export function toLanguage(value: string): SummaryLanguage | null {
  return LANGUAGES.find((l) => l.value === value)?.value ?? null;
}

export function LanguageOptions() {
  return (
    <>
      <option value="">Auto</option>
      {LANGUAGES.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
    </>
  );
}

function ReadOnly({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 break-all text-sm" dir="auto">{children}</dd>
    </div>
  );
}

interface Props {
  group: Group;
  /** Inline failure message from the last save, shown inside the dialog. */
  error: string | null;
  saving: boolean;
  onCancel: () => void;
  /** Save only the changed fields; the caller closes the dialog when this succeeds. */
  onSave: (patch: GroupPatch) => Promise<void>;
  /** Where focus goes after the dialog closes (default: the element focused when it opened). */
  returnFocus?: () => void;
}

export default function EditGroupDialog({ group, error, saving, onCancel, onSave, returnFocus }: Props) {
  const [displayName, setDisplayName] = useState(group.display_name ?? "");
  const [keys, setKeys] = useState<string[]>(group.community_keys);
  const [language, setLanguage] = useState<string>(group.summary_language ?? "");
  const nameInput = useRef<HTMLInputElement>(null);
  const keysHint = useId();
  const onCloseAutoFocus = useReturnFocus(returnFocus);

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: GroupPatch = {};
    if (displayName.trim() !== (group.display_name ?? "")) patch.display_name = displayName.trim() || null;
    if (JSON.stringify(keys) !== JSON.stringify(group.community_keys)) patch.community_keys = keys;
    if (language !== (group.summary_language ?? "")) patch.summary_language = toLanguage(language);
    if (Object.keys(patch).length === 0) return onCancel();
    void onSave(patch);
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent
        title="Edit group"
        description="WhatsApp name, topic and owner come from WhatsApp and cannot be edited here."
        closeDisabled={saving}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          nameInput.current?.focus();
        }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <form className="flex flex-col gap-4" onSubmit={submit}>
          <dl className="m-0 grid gap-2 rounded-md bg-surface-2 p-3">
            <ReadOnly label="WhatsApp name"><bdi>{group.group_name || group.group_jid}</bdi></ReadOnly>
            {group.group_topic && <ReadOnly label="Topic"><bdi>{group.group_topic}</bdi></ReadOnly>}
            <ReadOnly label="Owner"><bdi>{group.owner_jid ?? "unknown"}</bdi></ReadOnly>
          </dl>
          <Field label="Display name">
            <Input ref={nameInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={255} dir="auto" />
          </Field>
          <Field label="Summary language">
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <LanguageOptions />
            </Select>
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium" aria-hidden="true">Community keys</span>
            <TagInput value={keys} onChange={setKeys} label="Community keys" describedBy={keysHint} />
            <span id={keysHint} className="text-xs text-muted-foreground">
              Groups that share a key also receive each other&apos;s summaries and knowledge. Press Enter or comma to add a key.
            </span>
          </div>
          {error && <InlineError>{error}</InlineError>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button size="lg" className="md:min-h-10 md:text-sm" onClick={onCancel} disabled={saving}>Cancel</Button>
            <Button type="submit" variant="primary" size="lg" className="md:min-h-10 md:text-sm" disabled={saving}>
              Save
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
