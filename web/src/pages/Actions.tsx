import { useEffect, useRef, useState } from "react";
import { BookOpen, CircleAlert, CircleCheck, CircleDot, Loader, Send } from "lucide-react";
import { api } from "../api";
import { confirm, errorDialog, showSummaryResults, toast } from "../alerts";
import { Badge, type Tone } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Section } from "../components/ui/section";
import { Skeleton } from "../components/ui/skeleton";
import { describeResult } from "../results";
import type { ActionName, ActionStatus } from "../types";
import { useLoad, useLoadError } from "../useLoad";

const CARDS: { name: ActionName; icon: typeof Send; title: string; button: string; description: string; confirm: string }[] = [
  {
    name: "summarize",
    icon: Send,
    title: "Group summaries",
    button: "Run summaries now",
    description: "Generates an AI summary for every group where the bot is enabled and posts it to the group and its community groups.",
    confirm: "Generate and send summaries to all enabled groups now? This uses the LLM and posts to WhatsApp.",
  },
  {
    name: "load_kb",
    icon: BookOpen,
    title: "Knowledge base",
    button: "Load knowledge base topics",
    description: "Splits new conversations in enabled groups into topics and stores their embeddings.",
    confirm: "Load new knowledge-base topics for all enabled groups now? This uses the LLM and embedding services.",
  },
];

const STATES = {
  idle: { label: "Idle", tone: "neutral", icon: CircleDot },
  running: { label: "Running", tone: "warning", icon: Loader },
  succeeded: { label: "Succeeded", tone: "success", icon: CircleCheck },
  failed: { label: "Failed", tone: "danger", icon: CircleAlert },
} as const satisfies Record<ActionStatus["state"], { label: string; tone: Tone; icon: unknown }>;

function StateBadge({ state }: { state: ActionStatus["state"] }) {
  const { label, tone, icon } = STATES[state];
  return <Badge tone={tone} icon={icon}>{label}</Badge>;
}

const RESULT_TONE = { sent: "success", failed: "danger" } as const;

function Results({ name, status }: { name: ActionName; status: ActionStatus | undefined }) {
  if (name !== "summarize" || !status) return null;
  const results = status.results ?? [];
  const message = status.summary?.message;
  if (!results.length && !message) return null;
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <h3 className="text-sm font-semibold">Last run</h3>
      {status.summary && <p className="text-sm text-muted-foreground">{status.summary.managed_groups} managed group(s){message ? ` — ${message}` : ""}</p>}
      {results.length > 0 && (
        <ul role="list" aria-label="Summary results per group" className="m-0 list-none divide-y overflow-hidden rounded-md border p-0">
          {results.map((r) => (
            <li key={r.group_jid} className="flex items-start gap-3 p-3">
              <Badge className="mt-0.5" tone={RESULT_TONE[r.status as keyof typeof RESULT_TONE] ?? "warning"}>{r.status}</Badge>
              <div className="flex min-w-0 flex-col gap-0.5">
                <strong className="font-medium" dir="auto"><bdi>{r.group_name}</bdi></strong>
                <div className="text-xs text-muted-foreground">{describeResult(r)}</div>
              </div>
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
  const inlineError = useLoadError(error, data !== null);

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
    <div className="flex flex-col gap-5">
      <PageHeader title="Bot actions" description="Jobs run in the background on the server. Status is kept in memory and resets when the server restarts." />
      {inlineError && <InlineError>{inlineError}</InlineError>}
      {loading && !data ? (
        <div role="status" className="grid gap-4 md:grid-cols-2">
          <span className="sr-only">Loading…</span>
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      ) : !data ? null : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {CARDS.map((card) => {
            const status = data?.[card.name];
            return (
              <Section key={card.name} title={card.title} description={card.description}>
                <div className="flex flex-col gap-1.5 text-sm text-muted-foreground">
                  <div>{status && <StateBadge state={status.state} />}</div>
                  <div>Started: {when(status?.started_at ?? null)}</div>
                  <div>Finished: {when(status?.finished_at ?? null)}</div>
                </div>
                <Results name={card.name} status={status} />
                {status?.error && <InlineError>{status.error}</InlineError>}
                <Button variant="primary" size="lg" className="w-full md:w-auto md:self-start" disabled={status?.state === "running" || starting !== null} onClick={() => void run(card.name, card.title, card.confirm)}>
                  <card.icon aria-hidden="true" />{card.button}
                </Button>
              </Section>
            );
          })}
        </div>
      )}
    </div>
  );
}
