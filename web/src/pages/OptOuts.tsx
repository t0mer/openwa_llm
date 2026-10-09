import { useState, type FormEvent } from "react";
import { api } from "../api";
import { useLoad } from "../useLoad";

export default function OptOuts() {
  const { data, error, loading, reload } = useLoad(() => api.listOptOuts(), []);
  const [jid, setJid] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!jid.trim()) return;
    setActionError(null);
    setBusy("add");
    try {
      await api.addOptOut(jid.trim());
      setJid("");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    await reload();
  }

  async function remove(target: string) {
    if (!window.confirm(`Remove ${target} from the opt-out list? They will be tagged in summaries again.`)) return;
    setActionError(null);
    setBusy(target);
    try {
      await api.removeOptOut(target);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    await reload();
  }

  return (
    <section>
      <h1>Opt-outs</h1>
      <p className="muted">Opted-out contacts are shown by name instead of being @-mentioned in summaries and answers.</p>
      <form className="toolbar" onSubmit={add}>
        <input className="grow" placeholder="+972 50 123 4567 or 972501234567@s.whatsapp.net" value={jid} onChange={(e) => setJid(e.target.value)} aria-label="Phone number or JID" required disabled={busy !== null} />
        <button type="submit" className="primary" disabled={busy !== null}>Add</button>
      </form>
      {error && <p role="alert" className="error">{error}</p>}
      {actionError && <p role="alert" className="error">{actionError}</p>}
      {loading && !data ? (
        <p className="notice" role="status">Loading…</p>
      ) : (
        <table className="responsive" aria-label="Opt-outs">
          <thead><tr><th scope="col">Name</th><th scope="col">JID</th><th scope="col">Since</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {(data ?? []).map((o) => (
              <tr key={o.jid}>
                <td data-label="Name" className="cell-primary">{o.push_name ?? <span className="muted">—</span>}</td>
                <td data-label="JID" className="muted">{o.jid}</td>
                <td data-label="Since">{new Date(o.created_at).toLocaleString()}</td>
                <td className="cell-actions"><button type="button" className="danger" aria-label={`Remove ${o.jid}`} disabled={busy !== null} onClick={() => void remove(o.jid)}>Remove</button></td>
              </tr>
            ))}
            {data && data.length === 0 && <tr><td colSpan={4} className="muted empty-row">Nobody has opted out.</td></tr>}
          </tbody>
        </table>
      )}
    </section>
  );
}
