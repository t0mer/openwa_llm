import { useState, type FormEvent } from "react";
import { BellRing } from "lucide-react";
import { api } from "../api";
import { confirm, toast } from "../alerts";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Field, Input } from "../components/ui/field";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Skeleton } from "../components/ui/skeleton";
import { MD_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import type { OptOutItem } from "../types";
import { useErrorToast, useLoad } from "../useLoad";

interface RowProps {
  optOut: OptOutItem;
  busy: boolean;
  onRemove: (jid: string) => void;
}

const since = (o: OptOutItem) => new Date(o.created_at).toLocaleString();

function Person({ o }: { o: OptOutItem }) {
  return o.push_name ? <strong className="font-medium" dir="auto"><bdi>{o.push_name}</bdi></strong> : <span className="text-muted-foreground">—</span>;
}

function RemoveButton({ optOut: o, busy, onRemove, className, size }: RowProps & { className?: string; size?: "sm" | "lg" }) {
  return <Button variant="danger-outline" size={size} className={className} aria-label={`Remove ${o.jid}`} disabled={busy} onClick={() => onRemove(o.jid)}>Remove</Button>;
}

function OptOutTableRow(p: RowProps) {
  const o = p.optOut;
  return (
    <tr className="border-t align-middle hover:bg-surface-2/60">
      <td className="px-3 py-2"><Person o={o} /></td>
      <td className="break-all px-3 py-2 text-muted-foreground"><bdi className="jid">{o.jid}</bdi></td>
      <td className="whitespace-nowrap px-3 py-2">{since(o)}</td>
      <td className="px-3 py-2 text-end"><RemoveButton {...p} size="sm" /></td>
    </tr>
  );
}

function OptOutCard(p: RowProps) {
  const o = p.optOut;
  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <Person o={o} />
        <div className="break-all text-xs text-muted-foreground"><bdi className="jid">{o.jid}</bdi></div>
        <div className="text-xs text-muted-foreground">Since {since(o)}</div>
      </div>
      <RemoveButton {...p} size="lg" className="w-full" />
    </li>
  );
}

function LoadingRows({ desktop }: { desktop: boolean }) {
  return (
    <div role="status" className="rounded-lg border bg-surface p-3">
      <span className="sr-only">Loading…</span>
      {Array.from({ length: desktop ? 4 : 3 }, (_, i) => <Skeleton key={i} className={desktop ? "my-2 h-9" : "my-2 h-24"} />)}
    </div>
  );
}

export default function OptOuts() {
  const desktop = useMediaQuery(MD_QUERY);
  const { data, error, loading, reload } = useLoad(() => api.listOptOuts(), []);
  useErrorToast(error);
  const [jid, setJid] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!jid.trim()) return;
    setBusy("add");
    try {
      await api.addOptOut(jid.trim());
      setJid("");
      toast.success("Added to the opt-out list");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    await reload();
  }

  async function remove(target: string) {
    const ok = await confirm({
      title: "Remove from the opt-out list?",
      text: `${target} will be tagged in summaries again.`,
      confirmText: "Remove",
      danger: true,
    });
    if (!ok) return;
    setBusy(target);
    try {
      await api.removeOptOut(target);
      toast.success("Removed from the opt-out list");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
    await reload();
  }

  const items = data ?? [];
  const rowProps = (o: OptOutItem): RowProps => ({ optOut: o, busy: busy !== null, onRemove: (j) => void remove(j) });

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Opt-outs" description="Opted-out contacts are shown by name instead of being @-mentioned in summaries and answers." />
      <form aria-label="Add opt-out" className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-end" onSubmit={add}>
        <Field className="min-w-0 flex-1" label="Phone number or JID" hint="International format, e.g. +972 50 123 4567 or 972501234567@s.whatsapp.net">
          <Input placeholder="+972 50 123 4567 or 972501234567@s.whatsapp.net" value={jid} onChange={(e) => setJid(e.target.value)} required disabled={busy !== null} />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy !== null}>Add</Button>
      </form>
      <div className="flex flex-col gap-5">
        {error && <InlineError>{error}</InlineError>}
        {loading && !data ? (
          <LoadingRows desktop={desktop} />
        ) : data && items.length === 0 ? (
          <div className="rounded-lg border bg-surface">
            <EmptyState icon={BellRing} title="Nobody has opted out.">Contacts you add here are no longer @-mentioned by the bot.</EmptyState>
          </div>
        ) : desktop ? (
          <div className="overflow-x-auto rounded-lg border bg-surface">
            <table className="w-full text-start text-sm" aria-label="Opt-outs">
              <thead>
                <tr>
                  {["Name", "JID", "Since"].map((h) => <th key={h} scope="col" className="px-3 py-2 text-start font-medium text-muted-foreground">{h}</th>)}
                  <th scope="col" className="px-3 py-2"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>{items.map((o) => <OptOutTableRow key={o.jid} {...rowProps(o)} />)}</tbody>
            </table>
          </div>
        ) : (
          <ul role="list" aria-label="Opt-outs" className="m-0 list-none divide-y overflow-hidden rounded-lg border bg-surface p-0">
            {items.map((o) => <OptOutCard key={o.jid} {...rowProps(o)} />)}
          </ul>
        )}
      </div>
    </div>
  );
}
