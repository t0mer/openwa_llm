import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { toast } from "../alerts";
import { MessageSquare, SmilePlus } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Field, Input, Select } from "../components/ui/field";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { MD_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import type { Group, MessageItem } from "../types";

interface Filters {
  q: string;
  group_jid: string;
  sender_jid: string;
  from: string;
  to: string;
}

const EMPTY: Filters = { q: "", group_jid: "", sender_jid: "", from: "", to: "" };
const PAGE = 50;

function toIso(date: string, endOfDay: boolean): string | undefined {
  if (!date) return undefined;
  return new Date(`${date}T${endOfDay ? "23:59:59.999" : "00:00:00"}`).toISOString();
}

const when = (m: MessageItem) => new Date(m.timestamp).toLocaleString();

function Sender({ m }: { m: MessageItem }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <strong className="font-medium" dir="auto"><bdi>{m.sender_name ?? m.sender_jid}</bdi></strong>
      <div className="break-all text-xs text-muted-foreground"><bdi className="jid">{m.sender_jid}</bdi></div>
    </div>
  );
}

function Body({ m }: { m: MessageItem }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
      {m.reply_to_id && <Badge tone="info">reply</Badge>}
      {m.has_media && <Badge tone="info">media</Badge>}
      <span dir="auto" className="whitespace-pre-wrap break-words">{m.text}</span>
    </div>
  );
}

function MessageTableRow({ m }: { m: MessageItem }) {
  return (
    <tr className="border-t align-top hover:bg-surface-2/60">
      <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{when(m)}</td>
      <td className="px-3 py-2"><Sender m={m} /></td>
      <td className="px-3 py-2"><Body m={m} /></td>
      <td className="tabular px-3 py-2">{m.reaction_count || ""}</td>
    </tr>
  );
}

function MessageCard({ m }: { m: MessageItem }) {
  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex items-start justify-between gap-3">
        <Sender m={m} />
        {m.reaction_count > 0 && <Badge icon={SmilePlus}><span className="sr-only">Reactions: </span>{m.reaction_count}</Badge>}
      </div>
      <Body m={m} />
      <div className="text-xs text-muted-foreground">{when(m)}</div>
    </li>
  );
}

export default function Messages() {
  const desktop = useMediaQuery(MD_QUERY);
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [items, setItems] = useState<MessageItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);

  useEffect(() => {
    api.listGroups({ limit: 200, sort: "name" }).then((p) => setGroups(p.items)).catch(() => setGroups([]));
  }, []);

  const seq = useRef(0);

  const fetchPage = useCallback(async (f: Filters, before?: string) => {
    const id = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await api.listMessages({
        q: f.q.trim() || undefined,
        group_jid: f.group_jid || undefined,
        sender_jid: f.sender_jid.trim() || undefined,
        from: toIso(f.from, false),
        to: toIso(f.to, true),
        limit: PAGE,
        before,
      });
      if (id !== seq.current) return;
      setItems((prev) => (before ? [...prev, ...page.items] : page.items));
      setCursor(page.next_cursor);
      setLoading(false);
    } catch (e) {
      if (id !== seq.current) return;
      setError(e instanceof Error ? e.message : String(e));
      // A failed first page keeps the current rows but drops the cursor (it
      // belonged to the previous filters); a failed "Load older" keeps both.
      if (!before) setCursor(null);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (error) toast.error(error);
  }, [error]);

  useEffect(() => {
    void fetchPage(filters);
  }, [filters, fetchPage]);

  function apply(e: FormEvent) {
    e.preventDefault();
    if (draft.from && draft.to && draft.to < draft.from) {
      toast.error("To date must not be before From date.");
      return;
    }
    setFilters({ ...draft });
  }

  const first = loading && items.length === 0;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Messages" description="Read-only view, newest first." />
      <form role="search" aria-label="Message filters" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={apply}>
        <Field label="Search text">
          <Input placeholder="Search text" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        </Field>
        <Field label="Group">
          <Select value={draft.group_jid} onChange={(e) => setDraft({ ...draft, group_jid: e.target.value })}>
            <option value="">All groups</option>
            {groups.map((g) => (
              <option key={g.group_jid} value={g.group_jid}>{g.display_name || g.group_name || g.group_jid}</option>
            ))}
          </Select>
        </Field>
        <Field label="Sender JID">
          <Input placeholder="Sender JID" value={draft.sender_jid} onChange={(e) => setDraft({ ...draft, sender_jid: e.target.value })} />
        </Field>
        <Field label="From date">
          <Input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        </Field>
        <Field label="To date">
          <Input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        </Field>
        <div className="flex items-end">
          <Button type="submit" variant="primary" size="lg" className="w-full sm:w-auto">Apply</Button>
        </div>
      </form>
      <div className="flex flex-col gap-5">
        {error && <InlineError>{error}</InlineError>}
        {first ? (
          <div role="status" className="rounded-lg border bg-surface p-3">
            <span className="sr-only">Loading…</span>
            {Array.from({ length: desktop ? 6 : 3 }, (_, i) => <Skeleton key={i} className={desktop ? "my-2 h-9" : "my-2 h-24"} />)}
          </div>
        ) : items.length === 0 ? (
          !error && (
            <div className="rounded-lg border bg-surface">
              <EmptyState icon={MessageSquare} title="No messages match.">Try a different search or date range.</EmptyState>
            </div>
          )
        ) : desktop ? (
          <div className="overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full text-start text-sm" aria-label="Messages">
              <thead>
                <tr>{["Time", "Sender", "Message", "Reactions"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium text-muted-foreground">{h}</th>)}</tr>
              </thead>
              <tbody>{items.map((m) => <MessageTableRow key={m.message_id} m={m} />)}</tbody>
            </table>
          </div>
        ) : (
          <ul role="list" aria-label="Messages" className="m-0 list-none divide-y overflow-hidden rounded-lg border bg-surface p-0">
            {items.map((m) => <MessageCard key={m.message_id} m={m} />)}
          </ul>
        )}
        {loading && !first && <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        {cursor && (
          <div className="flex items-center gap-2">
            <Button size="lg" className="md:min-h-9" disabled={loading} onClick={() => void fetchPage(filters, cursor)}>Load older</Button>
          </div>
        )}
      </div>
    </div>
  );
}
