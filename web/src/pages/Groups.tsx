import { useRef, useState, type FormEvent } from "react";
import { Users } from "lucide-react";
import { api } from "../api";
import { confirm, toast } from "../alerts";
import EditGroupDialog, { LanguageOptions, toLanguage } from "../components/EditGroupDialog";
import SchedulesDialog from "../components/SchedulesDialog";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Input, Select } from "../components/ui/field";
import { FilterChip } from "../components/ui/filter-chip";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { MD_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import type { Group, GroupPatch, GroupSort } from "../types";
import { useErrorToast, useLoad } from "../useLoad";

const PAGE = 50;

type Managed = "all" | "managed" | "unmanaged";
const FILTERS: { value: Managed; label: string }[] = [
  { value: "all", label: "All" },
  { value: "managed", label: "Enabled" },
  { value: "unmanaged", label: "Disabled" },
];

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

const groupLabel = (g: Group) => g.display_name || g.group_name || g.group_jid;

/**
 * Dialog openers carry a stable key, so focus can return to the opener even when the table/cards
 * swap (a viewport resize while a dialog is open) replaced the element that opened it.
 */
type OpenerKind = "edit" | "schedules";
const openerKey = (kind: OpenerKind, g: Group) => `${kind}:${g.group_jid}`;

/** Everything a row or card needs to act on one group. */
interface RowProps {
  group: Group;
  saving: boolean;
  onToggleManaged: (g: Group) => void;
  onSave: (g: Group, patch: GroupPatch) => void;
  onSchedules: (g: Group) => void;
  onEdit: (g: Group) => void;
}

function GroupName({ g }: { g: Group }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <strong className="font-medium" dir="auto"><bdi>{groupLabel(g)}</bdi></strong>
      <div className="break-all text-xs text-muted-foreground">
        {g.display_name && g.group_name && <>WhatsApp: <bdi>{g.group_name}</bdi> · </>}<bdi className="jid">{g.group_jid}</bdi>
      </div>
      {g.group_topic && <div className="text-xs text-muted-foreground" dir="auto"><bdi>{g.group_topic}</bdi></div>}
    </div>
  );
}

/** Larger hit area (44px) without changing the switch's look. */
const SWITCH_HIT = "relative after:absolute after:-inset-2.5 after:content-['']";

function RespondSwitch({ group: g, saving, onToggleManaged }: RowProps) {
  return <Switch className={SWITCH_HIT} checked={g.managed} onCheckedChange={() => onToggleManaged(g)} aria-label={`Respond in ${g.group_jid}`} disabled={saving} />;
}

function SpamSwitch({ group: g, saving, onSave }: RowProps) {
  return <Switch className={SWITCH_HIT} checked={g.notify_on_spam} onCheckedChange={() => onSave(g, { notify_on_spam: !g.notify_on_spam })} aria-label={`Spam notice in ${g.group_jid}`} disabled={saving} />;
}

function LanguageSelect({ group: g, saving, onSave, className }: RowProps & { className?: string }) {
  return (
    <Select className={className} value={g.summary_language ?? ""} onChange={(e) => onSave(g, { summary_language: toLanguage(e.target.value) })} aria-label={`Summary language for ${groupLabel(g)}`} disabled={saving}>
      <LanguageOptions />
    </Select>
  );
}

function Keys({ g }: { g: Group }) {
  return g.community_keys.length ? <span dir="auto">{g.community_keys.join(", ")}</span> : <span className="text-muted-foreground">—</span>;
}

function GroupTableRow(p: RowProps) {
  const g = p.group;
  return (
    <tr className="border-t align-middle hover:bg-surface-2/60">
      <td className="px-3 py-1.5"><GroupName g={g} /></td>
      <td className="px-3 py-1.5"><RespondSwitch {...p} /></td>
      <td className="px-3 py-1.5"><SpamSwitch {...p} /></td>
      <td className="px-3 py-1.5"><div className="w-28"><LanguageSelect {...p} className="min-h-9" /></div></td>
      <td className="px-3 py-1.5"><Keys g={g} /></td>
      <td className="tabular px-3 py-1.5">{g.message_count}</td>
      <td className="whitespace-nowrap px-3 py-1.5">{fmt(g.last_summary_sync)}</td>
      <td className="px-3 py-1.5">
        <span className="inline-flex items-center gap-2">
          <span className="schedule-count tabular">{g.schedule_count}</span>
          <Button size="sm" data-opener={openerKey("schedules", g)} onClick={() => p.onSchedules(g)} aria-label={`Schedules for ${groupLabel(g)}`}>Schedules</Button>
        </span>
      </td>
      <td className="px-3 py-1.5 text-end"><Button size="sm" data-opener={openerKey("edit", g)} onClick={() => p.onEdit(g)} aria-label={`Edit ${g.group_jid}`}>Edit</Button></td>
    </tr>
  );
}

function Pair({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="m-0 flex min-h-11 items-center text-sm">{children}</dd>
    </div>
  );
}

function GroupCard(p: RowProps) {
  const g = p.group;
  return (
    <li className="flex flex-col gap-3 p-4">
      <GroupName g={g} />
      <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-2">
        <Pair label="Respond"><RespondSwitch {...p} /></Pair>
        <Pair label="Spam notice"><SpamSwitch {...p} /></Pair>
        <div className="col-span-2 flex flex-col gap-1.5">
          <dt className="text-xs font-medium text-muted-foreground">Summary language</dt>
          <dd className="m-0"><LanguageSelect {...p} /></dd>
        </div>
        <Pair label="Community keys"><Keys g={g} /></Pair>
        <Pair label="Messages"><span className="tabular">{g.message_count}</span></Pair>
        <Pair label="Schedules"><span className="schedule-count tabular">{g.schedule_count}</span></Pair>
        <div className="col-span-2 flex flex-col gap-1.5">
          <dt className="text-xs font-medium text-muted-foreground">Last summary</dt>
          <dd className="m-0 text-sm">{fmt(g.last_summary_sync)}</dd>
        </div>
      </dl>
      <div className="flex items-center gap-2">
        <Button size="lg" className="flex-1" data-opener={openerKey("schedules", g)} onClick={() => p.onSchedules(g)} aria-label={`Schedules for ${groupLabel(g)}`}>Schedules</Button>
        <Button size="lg" className="flex-1" data-opener={openerKey("edit", g)} onClick={() => p.onEdit(g)} aria-label={`Edit ${g.group_jid}`}>Edit</Button>
      </div>
    </li>
  );
}

const HEADERS = ["Group", "Respond", "Spam notice", "Summary language", "Community keys", "Messages", "Last summary", "Schedules"];

function LoadingRows({ desktop }: { desktop: boolean }) {
  return (
    <div role="status" className="rounded-lg border bg-surface p-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: desktop ? 6 : 3 }, (_, i) => <Skeleton key={i} className={desktop ? "my-2 h-9" : "my-2 h-32"} />)}
    </div>
  );
}

export default function Groups() {
  const desktop = useMediaQuery(MD_QUERY);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [managed, setManaged] = useState<Managed>("all");
  const [sort, setSort] = useState<GroupSort>("name");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Group | null>(null);
  const [scheduling, setScheduling] = useState<Group | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [savingJid, setSavingJid] = useState<string | null>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  /** Focus the current opener of a closed dialog, or the search box if the group left the list. */
  function returnFocus(key: string) {
    const opener = Array.from(document.querySelectorAll<HTMLElement>("[data-opener]")).find((el) => el.dataset.opener === key);
    (opener ?? searchInput.current)?.focus();
  }

  const { data, error, loading, reload } = useLoad(
    () =>
      api.listGroups({
        search: query,
        managed: managed === "all" ? undefined : managed === "managed",
        sort,
        limit: PAGE,
        offset,
      }),
    [query, managed, sort, offset],
  );
  useErrorToast(error);

  const label = groupLabel;

  /** Save a patch. Failures show inline in the edit dialog, otherwise as a toast. */
  async function save(group: Group, patch: GroupPatch, inline = false): Promise<boolean> {
    setDialogError(null);
    setSavingJid(group.group_jid);
    try {
      await api.patchGroup(group.group_jid, patch);
      toast.success(`Saved ${label(group)}`);
      await reload();
      return true;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      if (inline) setDialogError(message);
      else toast.error(message);
      await reload();
      return false;
    } finally {
      setSavingJid(null);
    }
  }

  async function toggleManaged(group: Group) {
    if (!group.managed) {
      const since = fmt(group.last_summary_sync);
      const ok = await confirm({
        title: `Enable the bot in "${label(group)}"?`,
        text: `It will reply to mentions immediately, and the next summary will cover every message since ${since}.`,
        confirmText: "Enable bot",
      });
      if (!ok) return;
    }
    void save(group, { managed: !group.managed });
  }

  function onSearch(e: FormEvent) {
    e.preventDefault();
    setOffset(0);
    setQuery(search.trim());
  }

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const rowProps = (group: Group): RowProps => ({
    group,
    saving: savingJid === group.group_jid,
    onToggleManaged: (g) => void toggleManaged(g),
    onSave: (g, patch) => void save(g, patch),
    onSchedules: setScheduling,
    onEdit: setEditing,
  });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Groups" description="Choose where the bot replies, how summaries are written and when they are sent." />
      <form role="search" aria-label="Group filters" className="flex flex-col gap-3" onSubmit={onSearch}>
        <div className="flex flex-wrap gap-2">
          <Input ref={searchInput} className="min-w-0 flex-1 basis-56" placeholder="Search name, topic or JID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
          <Button type="submit" variant="primary" size="lg">Search</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Filter" className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <FilterChip key={f.value} active={managed === f.value} onClick={() => { setOffset(0); setManaged(f.value); }}>{f.label}</FilterChip>
            ))}
          </div>
          <div className="w-full sm:ms-auto sm:w-56">
            <Select value={sort} onChange={(e) => { setOffset(0); setSort(e.target.value as GroupSort); }} aria-label="Sort">
              <option value="name">Name</option>
              <option value="-message_count">Most messages</option>
              <option value="-last_summary_sync">Last summary (newest)</option>
              <option value="last_summary_sync">Last summary (oldest)</option>
              <option value="-created_at">Newest</option>
            </Select>
          </div>
        </div>
        <p aria-live="polite" className="text-sm text-muted-foreground">{total} groups</p>
      </form>
      {/*
        A stable wrapper around everything that swaps (error, loading, empty, table <-> cards). An open
        modal dialog hides the page from assistive tech when it opens; elements created later inside
        this wrapper (e.g. the cards after a resize) inherit that, instead of appearing un-hidden.
      */}
      <div className="flex flex-col gap-5">
      {error && <InlineError>{error}</InlineError>}
      {loading && !data ? (
        <LoadingRows desktop={desktop} />
      ) : data && items.length === 0 ? (
        <div className="rounded-lg border bg-surface">
          <EmptyState icon={Users} title="No groups match.">Try a different search or filter.</EmptyState>
        </div>
      ) : desktop ? (
        <div className="overflow-x-auto rounded-lg border bg-surface">
          <table className="w-full text-start text-sm" aria-label="Groups">
            <thead>
              <tr className="text-start">
                {HEADERS.map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium text-muted-foreground">{h}</th>)}
                <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => <GroupTableRow key={g.group_jid} {...rowProps(g)} />)}
            </tbody>
          </table>
        </div>
      ) : (
        <ul role="list" aria-label="Groups" className="m-0 list-none divide-y overflow-hidden rounded-lg border bg-surface p-0">
          {items.map((g) => <GroupCard key={g.group_jid} {...rowProps(g)} />)}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button size="lg" className="md:min-h-9" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</Button>
        <Button size="lg" className="md:min-h-9" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</Button>
      </div>
      </div>
      {scheduling && (
        <SchedulesDialog
          group={{ group_jid: scheduling.group_jid, label: label(scheduling), managed: scheduling.managed }}
          onClose={() => setScheduling(null)}
          onChanged={() => void reload()}
        />
      )}
      {editing && (
        <EditGroupDialog
          group={editing}
          returnFocus={() => returnFocus(openerKey("edit", editing))}
          error={dialogError}
          saving={savingJid === editing.group_jid}
          onCancel={() => { setDialogError(null); setEditing(null); }}
          onSave={async (patch) => {
            if (await save(editing, patch, true)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}
