import { useEffect, useRef, useState, type FormEvent } from "react";
import { UserRound } from "lucide-react";
import { api } from "../api";
import { toast } from "../alerts";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Input } from "../components/ui/field";
import { FilterChip } from "../components/ui/filter-chip";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { MD_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import type { Contact } from "../types";
import { useLoad, useLoadError } from "../useLoad";

const PAGE = 50;

type Filter = "all" | "opted" | "not";
const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All contacts" },
  { value: "opted", label: "Opted out" },
  { value: "not", label: "Not opted out" },
];

/** Everything a row or card needs; the editing state lives in the page so a table/cards swap keeps it. */
interface RowProps {
  contact: Contact;
  editing: boolean;
  name: string;
  saving: boolean;
  actionError: string | null;
  onName: (v: string) => void;
  onEdit: (c: Contact) => void;
  onCancel: () => void;
  onSave: (jid: string) => void;
  onInputFocus: () => void;
  onInputBlur: (el: HTMLInputElement) => void;
}

function NameCell({ contact: c, editing, name, saving, actionError, onName, onInputFocus, onInputBlur }: RowProps) {
  if (editing) {
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <Input data-edit-input={c.jid} onFocus={onInputFocus} onBlur={(e) => onInputBlur(e.currentTarget)} aria-label={`Name for ${c.jid}`} value={name} onChange={(e) => onName(e.target.value)} maxLength={255} disabled={saving} />
        {actionError && <InlineError>{actionError}</InlineError>}
      </div>
    );
  }
  return c.push_name ? <strong className="font-medium" dir="auto"><bdi>{c.push_name}</bdi></strong> : <span className="text-muted-foreground">—</span>;
}

function Status({ c }: { c: Contact }) {
  return c.opted_out ? <Badge tone="warning">Opted out</Badge> : <Badge>Tagged</Badge>;
}

function Actions({ p, className, size }: { p: RowProps; className?: string; size?: "table" | "lg" }) {
  const c = p.contact;
  return p.editing ? (
    <>
      <Button size={size} className={className} variant="primary" disabled={p.saving} onClick={() => p.onSave(c.jid)}>Save</Button>
      <Button size={size} className={className} disabled={p.saving} onClick={p.onCancel}>Cancel</Button>
    </>
  ) : (
    <Button size={size} className={className} data-edit-for={c.jid} aria-label={`Edit ${c.jid}`} disabled={p.saving} onClick={() => p.onEdit(c)}>Edit</Button>
  );
}

function ContactTableRow(p: RowProps) {
  const c = p.contact;
  return (
    <tr className="border-t align-middle hover:bg-surface-2/60">
      <td className="px-3 py-2"><NameCell {...p} /></td>
      <td className="break-all px-3 py-2 text-muted-foreground"><bdi className="jid">{c.jid}</bdi></td>
      <td className="px-3 py-2"><Status c={c} /></td>
      <td className="px-3 py-2"><div className="flex items-center justify-end gap-2"><Actions p={p} size="table" /></div></td>
    </tr>
  );
}

function ContactCard(p: RowProps) {
  const c = p.contact;
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <NameCell {...p} />
          <div className="break-all text-xs text-muted-foreground"><bdi className="jid">{c.jid}</bdi></div>
        </div>
        <Status c={c} />
      </div>
      <div className="flex items-center gap-2"><Actions p={p} size="lg" className="flex-1" /></div>
    </li>
  );
}

function LoadingRows({ desktop }: { desktop: boolean }) {
  return (
    <div role="status" className="rounded-lg border bg-surface p-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: desktop ? 6 : 3 }, (_, i) => <Skeleton key={i} className={desktop ? "my-2 h-9" : "my-2 h-24"} />)}
    </div>
  );
}

export default function Contacts() {
  const desktop = useMediaQuery(MD_QUERY);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [offset, setOffset] = useState(0);
  const [editJid, setEditJid] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listContacts({
        search: query,
        opted_out: filter === "all" ? undefined : filter === "opted",
        limit: PAGE,
        offset,
      }),
    [query, filter, offset],
  );
  const inlineError = useLoadError(error, data !== null);

  useEffect(() => {
    setEditJid(null);
    setActionError(null);
  }, [query, filter, offset]);

  const total = data?.total ?? 0;
  useEffect(() => {
    if (data && offset > 0 && offset >= total) {
      setOffset(total > 0 ? Math.floor((total - 1) / PAGE) * PAGE : 0);
    }
  }, [data, offset, total]);

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    setQuery(search.trim());
  }

  /** Focus follows the edit: into the input on Edit, back to the row's Edit button when it closes. */
  const focusEdit = useRef(false);
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    const all = (sel: string) => Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (editJid) {
      if (focusEdit.current) all("[data-edit-input]").find((el) => el.dataset.editInput === editJid)?.focus();
    } else if (returnTo.current) {
      const jid = returnTo.current;
      returnTo.current = null;
      all("[data-edit-for]").find((el) => el.dataset.editFor === jid)?.focus();
    }
  }, [editJid, desktop, saving]);

  function startEdit(c: Contact) {
    focusEdit.current = true;
    setActionError(null);
    setEditJid(c.jid);
    setName(c.push_name ?? "");
  }

  function cancelEdit() {
    returnTo.current = editJid;
    setActionError(null);
    setEditJid(null);
  }

  async function save(jid: string) {
    setActionError(null);
    focusEdit.current = true;
    setSaving(true);
    try {
      await api.patchContact(jid, name.trim() || null);
      returnTo.current = jid;
      setEditJid(null);
      toast.success("Contact updated");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
    await reload();
  }

  const items = data?.items ?? [];
  const rowProps = (c: Contact): RowProps => ({
    contact: c,
    editing: editJid === c.jid,
    name,
    saving,
    actionError,
    onName: setName,
    onEdit: startEdit,
    onCancel: cancelEdit,
    onSave: (jid) => void save(jid),
    onInputFocus: () => { focusEdit.current = true; },
    // A removed input (table <-> cards swap) or a disabled one (saving) keeps the flag; a real blur clears it.
    onInputBlur: (el) => queueMicrotask(() => { if (el.isConnected && !el.disabled) focusEdit.current = false; }),
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Contacts" description="People the bot has seen. Rename them or check who has opted out of being tagged." />
      <form role="search" aria-label="Contact filters" className="flex flex-col gap-3" onSubmit={onSearch}>
        <div className="flex flex-wrap gap-2">
          <Input className="min-w-0 flex-1 basis-56" placeholder="Search name or JID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
          <Button type="submit" variant="primary" size="lg">Search</Button>
        </div>
        <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <FilterChip key={f.value} active={filter === f.value} onClick={() => { setOffset(0); setFilter(f.value); }}>{f.label}</FilterChip>
          ))}
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">{total} contacts</p>
      </form>
      <div className="flex flex-col gap-5">
        {inlineError && <InlineError>{inlineError}</InlineError>}
        {loading && !data ? (
          <LoadingRows desktop={desktop} />
        ) : data && items.length === 0 ? (
          <div className="rounded-lg border bg-surface">
            <EmptyState icon={UserRound} title="No contacts match.">Try a different search or filter.</EmptyState>
          </div>
        ) : !data ? null : desktop ? (
          <div className="overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full text-start text-sm" aria-label="Contacts">
              <thead>
                <tr>
                  {["Name", "JID", "Status"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium text-muted-foreground">{h}</th>)}
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>{items.map((c) => <ContactTableRow key={c.jid} {...rowProps(c)} />)}</tbody>
            </table>
          </div>
        ) : (
          <ul role="list" aria-label="Contacts" className="m-0 list-none divide-y overflow-hidden rounded-lg border bg-surface p-0">
            {items.map((c) => <ContactCard key={c.jid} {...rowProps(c)} />)}
          </ul>
        )}
        <div className="flex items-center gap-2">
          <Button size="lg" className="lg:min-h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
          <Button size="lg" className="lg:min-h-9" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
        </div>
      </div>
    </div>
  );
}
