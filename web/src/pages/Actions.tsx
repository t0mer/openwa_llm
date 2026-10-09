import { useRef, useState } from "react";
import { api } from "../api";
import { confirm, errorDialog, toast } from "../alerts";
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

function when(ts: string | null) {
  return ts ? new Date(ts).toLocaleString() : "—";
}

export default function Actions() {
  const [starting, setStarting] = useState<ActionName | null>(null);
  const startingRef = useRef<ActionName | null>(null);
  const { data, error, loading, reload } = useLoad(() => api.getActions(), [], 5_000);
  useErrorToast(error);

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
