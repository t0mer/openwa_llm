import { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { confirm, errorDialog, showSummaryResults, toast } from "../alerts";
import { describeResult } from "../results";
import type { ActionName, ActionStatus } from "../types";
import { useErrorToast, useLoad } from "../useLoad";

const CARDS: { name: ActionName; title: string; button: string; description: string; confirm: string }[] = [
  {
    name: "summarize",
    title: "Group summaries",
    button: "Run summaries now",
    description: "Generates an AI summary for every group where the bot is enabled and posts it to the group and its community groups.",
    confirm: "Generate and send summaries to all enabled groups now? This uses the LLM and posts to WhatsApp.",
  },
  {
    name: "load_kb",
    title: "Knowledge base",
    button: "Load knowledge base topics",
    description: "Splits new conversations in enabled groups into topics and stores their embeddings.",
    confirm: "Load new knowledge-base topics for all enabled groups now? This uses the LLM and embedding services.",
  },
];

function badge(state: ActionStatus["state"]) {
  const map = { idle: ["Idle", ""], running: ["Running", "warn"], succeeded: ["Succeeded", "ok"], failed: ["Failed", "bad"] } as const;
  const [label, cls] = map[state];
  return <span className={`badge ${cls}`}>{label}</span>;
}

function renderResults(name: ActionName, status: ActionStatus | undefined) {
  if (name !== "summarize" || !status) return null;
  const results = status.results ?? [];
  const message = status.summary?.message;
  if (!results.length && !message) return null;
  return (
    <div className="results">
      <h3>Last run</h3>
      {status.summary && <p className="muted">{status.summary.managed_groups} managed group(s){message ? ` — ${message}` : ""}</p>}
      {results.length > 0 && (
        <ul aria-label="Summary results per group">
          {results.map((r) => (
            <li key={r.group_jid}>
              <span className={`badge ${r.status === "sent" ? "ok" : r.status === "failed" ? "bad" : "warn"}`}>{r.status}</span>{" "}
              <strong>{r.group_name}</strong>
              <div className="muted">{describeResult(r)}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function when(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default function Actions() {
  const [starting, setStarting] = useState<ActionName | null>(null);
  const startingRef = useRef<ActionName | null>(null);
  const { data, error, loading, reload } = useLoad(() => api.getActions(), [], 5_000);
  useErrorToast(error);

  // Pop the per-group results up when a summarize run finishes while this page is open.
  const seenFinish = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const st = data?.summarize;
    if (!st) return;
    const previous = seenFinish.current;
    seenFinish.current = st.finished_at;
    if (previous === undefined || st.finished_at === previous) return;
    if (st.state !== "succeeded" && st.state !== "failed") return;
    if (st.results?.length || st.summary?.message) {
      void showSummaryResults(st.results ?? [], st.summary?.message);
    }
  }, [data]);

  async function run(name: ActionName, confirmTitle: string, confirmText: string) {
    if (startingRef.current) return;
    startingRef.current = name;
    setStarting(name);
    try {
      const ok = await confirm({ title: confirmTitle, text: confirmText, confirmText: "Run now" });
      if (!ok) return;
      await api.runAction(name);
      toast.success("Job started. Status updates here automatically.");
    } catch (e) {
      void errorDialog("Could not start the job", e instanceof Error ? e.message : String(e));
    } finally {
      startingRef.current = null;
      setStarting(null);
    }
    await reload();
  }

  return (
    <section>
      <h1>Bot actions</h1>
      <p className="muted">Jobs run in the background on the server. Status is kept in memory and resets when the server restarts.</p>
      {loading && !data ? (
        <p className="notice" role="status">Loading…</p>
      ) : (
        <div className="cards">
          {CARDS.map((card) => {
            const status = data?.[card.name];
            return (
              <div className="card" key={card.name}>
                <h2>{card.title}</h2>
                <p className="muted">{card.description}</p>
                <div>{status && badge(status.state)}</div>
                <div className="muted">Started: {when(status?.started_at ?? null)}</div>
                <div className="muted">Finished: {when(status?.finished_at ?? null)}</div>
                {renderResults(card.name, status)}
                {status?.error && <div role="alert" className="inline-error">{status.error}</div>}
                <div>
                  <button type="button" className="primary" disabled={status?.state === "running" || starting !== null} onClick={() => void run(card.name, card.title, card.confirm)}>
                    {card.button}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
