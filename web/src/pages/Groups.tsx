import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "../api";
import { confirm, toast } from "../alerts";
import TagInput from "../components/TagInput";
import type { Group, GroupPatch, GroupSort } from "../types";
import { useErrorToast, useLoad } from "../useLoad";

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
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [savingJid, setSavingJid] = useState<string | null>(null);

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

  const label = (g: Group) => g.display_name || g.group_name || g.group_jid;

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

  return (
    <section>
      <h1>Groups</h1>
      <form className="toolbar" onSubmit={onSearch}>
        <input className="grow" placeholder="Search name, topic or JID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search groups" />
        <button type="submit">Search</button>
        <select value={managed} onChange={(e) => { setOffset(0); setManaged(e.target.value as typeof managed); }} aria-label="Filter">
          <option value="all">All groups</option>
          <option value="managed">Bot enabled</option>
          <option value="unmanaged">Bot disabled</option>
        </select>
        <select value={sort} onChange={(e) => { setOffset(0); setSort(e.target.value as GroupSort); }} aria-label="Sort">
          <option value="name">Name</option>
          <option value="-message_count">Most messages</option>
          <option value="-last_summary_sync">Last summary (newest)</option>
          <option value="last_summary_sync">Last summary (oldest)</option>
          <option value="-created_at">Newest</option>
        </select>
        <span className="muted">{total} groups</span>
      </form>
      {loading && !data ? (
        <p className="notice" role="status">Loading…</p>
      ) : (
        <table className="responsive" aria-label="Groups">
          <thead>
            <tr><th scope="col">Group</th><th scope="col">Respond</th><th scope="col">Spam notice</th><th scope="col">Community keys</th><th scope="col">Messages</th><th scope="col">Last summary</th><th scope="col"><span className="sr-only">Actions</span></th></tr>
          </thead>
          <tbody>
            {(data?.items ?? []).map((g) => (
              <tr key={g.group_jid}>
                <td data-label="Group" className="cell-primary">
                  <strong>{label(g)}</strong>
                  <div className="muted">
                    {g.display_name && g.group_name ? `WhatsApp: ${g.group_name} · ` : ""}{g.group_jid}
                  </div>
                  {g.group_topic && <div className="muted">{g.group_topic}</div>}
                </td>
                <td data-label="Respond">
                  <input type="checkbox" className="switch" checked={g.managed} onChange={() => void toggleManaged(g)} aria-label={`Respond in ${g.group_jid}`} disabled={savingJid === g.group_jid} />
                </td>
                <td data-label="Spam notice">
                  <input type="checkbox" className="switch" checked={g.notify_on_spam} onChange={() => void save(g, { notify_on_spam: !g.notify_on_spam })} aria-label={`Spam notice in ${g.group_jid}`} disabled={savingJid === g.group_jid} />
                </td>
                <td data-label="Community keys">{g.community_keys.length ? g.community_keys.join(", ") : <span className="muted">—</span>}</td>
                <td data-label="Messages">{g.message_count}</td>
                <td data-label="Last summary">{fmt(g.last_summary_sync)}</td>
                <td className="cell-actions"><button type="button" onClick={() => setEditing(g)} aria-label={`Edit ${g.group_jid}`}>Edit</button></td>
              </tr>
            ))}
            {data && data.items.length === 0 && (
              <tr><td colSpan={7} className="muted empty-row">No groups match.</td></tr>
            )}
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
          error={dialogError}
          saving={savingJid === editing.group_jid}
          onCancel={() => { setDialogError(null); setEditing(null); }}
          onSave={async (patch) => {
            if (await save(editing, patch, true)) setEditing(null);
          }}
        />
      )}
    </section>
  );
}

function EditGroup({ group, error, saving, onCancel, onSave }: { group: Group; error: string | null; saving: boolean; onCancel: () => void; onSave: (patch: GroupPatch) => Promise<void> }) {
  const [displayName, setDisplayName] = useState(group.display_name ?? "");
  const [keys, setKeys] = useState<string[]>(group.community_keys);
  const nameInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    nameInput.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function submit(e: FormEvent) {
    e.preventDefault();
    const patch: GroupPatch = {};
    if (displayName.trim() !== (group.display_name ?? "")) patch.display_name = displayName.trim() || null;
    if (JSON.stringify(keys) !== JSON.stringify(group.community_keys)) patch.community_keys = keys;
    if (Object.keys(patch).length === 0) return onCancel();
    void onSave(patch);
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <form className="modal" role="dialog" aria-modal="true" aria-label="Edit group" onSubmit={submit}>
        <h2>{group.group_name || group.group_jid}</h2>
        <p className="muted">WhatsApp name, topic and owner come from WhatsApp and cannot be edited here.</p>
        {group.group_topic && <p className="muted">Topic: {group.group_topic}</p>}
        <p className="muted">Owner: {group.owner_jid ?? "unknown"}</p>
        <label>
          Display name
          <input ref={nameInput} value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={255} />
        </label>
        <div>
          <strong>Community keys</strong>
          <p className="muted">Groups that share a key also receive each other&apos;s summaries and knowledge.</p>
          <TagInput value={keys} onChange={setKeys} label="Community keys" />
        </div>
        {error && <p role="alert" className="inline-error">{error}</p>}
        <div className="toolbar">
          <button type="submit" className="primary" disabled={saving}>Save</button>
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}
