import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { toast } from "../alerts";
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

export default function Messages() {
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

  return (
    <section>
      <h1>Messages</h1>
      <p className="muted">Read-only view, newest first.</p>
      <form className="toolbar" onSubmit={apply}>
        <input aria-label="Search text" className="grow" placeholder="Search text" value={draft.q} onChange={(e) => setDraft({ ...draft, q: e.target.value })} />
        <select aria-label="Group" value={draft.group_jid} onChange={(e) => setDraft({ ...draft, group_jid: e.target.value })}>
          <option value="">All groups</option>
          {groups.map((g) => (
            <option key={g.group_jid} value={g.group_jid}>{g.display_name || g.group_name || g.group_jid}</option>
          ))}
        </select>
        <input aria-label="Sender JID" placeholder="Sender JID" value={draft.sender_jid} onChange={(e) => setDraft({ ...draft, sender_jid: e.target.value })} />
        <input aria-label="From date" type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} />
        <input aria-label="To date" type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} />
        <button type="submit" className="primary">Apply</button>
      </form>
      <table className="responsive" aria-label="Messages">
        <thead><tr><th scope="col">Time</th><th scope="col">Sender</th><th scope="col">Message</th><th scope="col">Reactions</th></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.message_id}>
              <td data-label="Time" className="muted"><div className="cell-value">{new Date(m.timestamp).toLocaleString()}</div></td>
              <td data-label="Sender"><div className="cell-value">{m.sender_name ?? m.sender_jid}<div className="muted">{m.sender_jid}</div></div></td>
              <td data-label="Message" className="msg-text"><div className="cell-value">
                {m.reply_to_id && <span className="badge">reply</span>} {m.has_media && <span className="badge">media</span>} {m.text}
              </div></td>
              <td data-label="Reactions"><div className="cell-value">{m.reaction_count || ""}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      {!loading && items.length === 0 && !error && <p className="empty" role="status">No messages match.</p>}
      {loading && <p className="notice" role="status">Loading…</p>}
      {cursor && (
        <div className="toolbar">
          <button type="button" disabled={loading} onClick={() => void fetchPage(filters, cursor)}>Load older</button>
        </div>
      )}
    </section>
  );
}
