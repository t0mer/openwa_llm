import { useState, type FormEvent } from "react";
import { api } from "../api";
import TagInput from "../components/TagInput";
import type { Group, GroupPatch, GroupSort } from "../types";
import { useLoad } from "../useLoad";

const PAGE = 50;

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

export default function Groups() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [managed, setManaged] = useState<"all" | "managed" | "unmanaged">("all");
  const [sort, setSort] = useState<GroupSort>("name");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Group | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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

  async function save(group: Group, patch: GroupPatch) {
    setActionError(null);
    try {
      await api.patchGroup(group.group_jid, patch);
      await reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      await reload();
    }
  }

  function toggleManaged(group: Group) {
    if (!group.managed) {
      const since = fmt(group.last_summary_sync);
      const ok = window.confirm(
        `Enable the bot in "${group.display_name || group.group_name || group.group_jid}"?\n\n` +
          `It will reply to mentions immediately, and the next summary will cover every message since ${since}.`,
      );
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

  return (
    <section>
      <h1>Groups</h1>
      <form className="toolbar" onSubmit={onSearch}>
        <input placeholder="Search name, topic or JID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
        <button type="submit">Search</button>
        <select value={managed} onChange={(e) => { setOffset(0); setManaged(e.target.value as typeof managed); }} aria-label="Filter">
          <option value="all">All groups</option>
          <option value="managed">Bot enabled</option>
          <option value="unmanaged">Bot disabled</option>
        </select>
        <select value={sort} onChange={(e) => setSort(e.target.value as GroupSort)} aria-label="Sort">
          <option value="name">Name</option>
          <option value="-message_count">Most messages</option>
          <option value="-last_summary_sync">Last summary (newest)</option>
          <option value="last_summary_sync">Last summary (oldest)</option>
          <option value="-created_at">Newest</option>
        </select>
        <span className="muted">{total} groups</span>
      </form>
      {(error || actionError) && <p role="alert" className="error">{actionError ?? error}</p>}
      {loading && !data ? (
        <p className="notice">Loading…</p>
      ) : (
        <table>
          <thead>
            <tr><th>Group</th><th>Respond</th><th>Spam notice</th><th>Community keys</th><th>Messages</th><th>Last summary</th><th /></tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((g) => (
              <tr key={g.group_jid}>
                <td>
                  <strong>{g.display_name || g.group_name || g.group_jid}</strong>
                  <div className="muted">
                    {g.display_name && g.group_name ? `WhatsApp: ${g.group_name} · ` : ""}{g.group_jid}
                  </div>
                  {g.group_topic && <div className="muted">{g.group_topic}</div>}
                </td>
                <td>
                  <input type="checkbox" checked={g.managed} onChange={() => toggleManaged(g)} aria-label={`Respond in ${g.group_jid}`} />
                </td>
                <td>
                  <input type="checkbox" checked={g.notify_on_spam} onChange={() => void save(g, { notify_on_spam: !g.notify_on_spam })} aria-label={`Spam notice in ${g.group_jid}`} />
                </td>
                <td>{g.community_keys.length ? g.community_keys.join(", ") : <span className="muted">—</span>}</td>
                <td>{g.message_count}</td>
                <td>{fmt(g.last_summary_sync)}</td>
                <td><button type="button" onClick={() => setEditing(g)} aria-label={`Edit ${g.group_jid}`}>Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="toolbar">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
        <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
      </div>
      {editing && (
        <EditGroup
          group={editing}
          onCancel={() => setEditing(null)}
          onSave={async (patch) => {
            await save(editing, patch);
            setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function EditGroup({ group, onCancel, onSave }: { group: Group; onCancel: () => void; onSave: (patch: GroupPatch) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(group.display_name ?? "");
  const [keys, setKeys] = useState<string[]>(group.community_keys);

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: GroupPatch = {};
    if (displayName.trim() !== (group.display_name ?? "")) patch.display_name = displayName.trim() || null;
    if (JSON.stringify(keys) !== JSON.stringify(group.community_keys)) patch.community_keys = keys;
    if (Object.keys(patch).length === 0) return onCancel();
    void onSave(patch);
  }

  return (
    <div className="modal-backdrop">
      <form className="modal" role="dialog" aria-label="Edit group" onSubmit={submit}>
        <h2>{group.group_name || group.group_jid}</h2>
        <p className="muted">WhatsApp name, topic and owner come from WhatsApp and cannot be edited here.</p>
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={255} />
        </label>
        <div>
          <span id="keys-label">Community keys</span>
          <p className="muted">Groups that share a key also receive each other&apos;s summaries and knowledge.</p>
          <TagInput value={keys} onChange={setKeys} label="Community keys" />
        </div>
        <div className="toolbar">
          <button type="submit" className="primary">Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
