import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import { toast } from "../alerts";
import { useErrorToast, useLoad } from "../useLoad";

const PAGE = 50;

export default function Contacts() {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "opted" | "not">("all");
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
  useErrorToast(error);

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

  function startEdit(jid: string, current: string | null) {
    setActionError(null);
    setEditJid(jid);
    setName(current ?? "");
  }

  function cancelEdit() {
    setActionError(null);
    setEditJid(null);
  }

  async function save(jid: string) {
    setActionError(null);
    setSaving(true);
    try {
      await api.patchContact(jid, name.trim() || null);
      setEditJid(null);
      toast.success("Contact updated");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
    await reload();
  }

  return (
    <section>
      <h1>Contacts</h1>
      <form className="toolbar" onSubmit={onSearch}>
        <input className="grow" placeholder="Search name or JID" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search contacts" />
        <button type="submit">Search</button>
        <select value={filter} onChange={(e) => { setOffset(0); setFilter(e.target.value as typeof filter); }} aria-label="Filter">
          <option value="all">All contacts</option>
          <option value="opted">Opted out</option>
          <option value="not">Not opted out</option>
        </select>
        <span className="muted">{total} contacts</span>
      </form>
      {loading && !data ? (
        <p className="notice" role="status">Loading…</p>
      ) : (
        <table className="responsive" aria-label="Contacts">
          <thead><tr><th scope="col">Name</th><th scope="col">JID</th><th scope="col">Status</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {(data?.items ?? []).map((c) => (
              <tr key={c.jid}>
                <td data-label="Name" className="cell-primary"><div className="cell-value">
                  {editJid === c.jid ? (
                    <>
                      <input aria-label={`Name for ${c.jid}`} value={name} onChange={(e) => setName(e.target.value)} maxLength={255} disabled={saving} />
                      {actionError && <p role="alert" className="inline-error">{actionError}</p>}
                    </>
                  ) : (
                    c.push_name ? <bdi>{c.push_name}</bdi> : <span className="muted">—</span>
                  )}
                </div></td>
                <td data-label="JID" className="muted"><div className="cell-value"><bdi className="jid">{c.jid}</bdi></div></td>
                <td data-label="Status"><div className="cell-value">{c.opted_out ? <span className="badge warn">Opted out</span> : <span className="badge">Tagged</span>}</div></td>
                <td className="cell-actions">
                  {editJid === c.jid ? (
                    <>
                      <button type="button" className="primary" disabled={saving} onClick={() => void save(c.jid)}>Save</button>{" "}
                      <button type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>
                    </>
                  ) : (
                    <button type="button" aria-label={`Edit ${c.jid}`} disabled={saving} onClick={() => startEdit(c.jid, c.push_name)}>Edit</button>
                  )}
                </td>
              </tr>
            ))}
            {data && data.items.length === 0 && <tr><td colSpan={4} className="muted empty-row">No contacts match.</td></tr>}
          </tbody>
        </table>
      )}
      <div className="toolbar">
        <button type="button" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
        <button type="button" disabled={offset + PAGE >= total} onClick={() => setOffset(offset + PAGE)}>Next</button>
      </div>
    </section>
  );
}
