import { useState, type FormEvent } from "react";
import { CircleAlert, CircleCheck, Smartphone } from "lucide-react";
import { api } from "../api";
import { confirm, toast } from "../alerts";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/empty-state";
import { Field, Input } from "../components/ui/field";
import { InlineError } from "../components/ui/inline-error";
import { PageHeader } from "../components/ui/page-header";
import { Section } from "../components/ui/section";
import { Skeleton } from "../components/ui/skeleton";
import { Switch } from "../components/ui/switch";
import { notifySessionsChanged } from "../session";
import type { ConnectionSettings, ConnectionTestResult, SessionInfo } from "../types";
import { useLoad, useLoadError } from "../useLoad";

const STORED = "•••• stored";
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
/** Trimmed, or null when blank: a blank secret keeps the stored one. */
const orNull = (value: string) => value.trim() || null;
const REENTER = "Changing the URL requires re-entering the API key and webhook secret";
/** Same comparison as the server: trimmed, trailing slashes ignored. */
const sameUrl = (a: string, b: string) => a.trim().replace(/\/+$/, "") === b.trim().replace(/\/+$/, "");

function Loading() {
  return (
    <div role="status" className="flex flex-col gap-2">
      <span className="sr-only">Loading…</span>
      <Skeleton className="h-11" />
      <Skeleton className="h-11" />
    </div>
  );
}

function ConnectionForm({ stored, onSaved }: { stored: ConnectionSettings; onSaved: () => void }) {
  const [baseUrl, setBaseUrl] = useState(stored.base_url);
  const [webhookUrl, setWebhookUrl] = useState(stored.webhook_url);
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [test, setTest] = useState<ConnectionTestResult | null>(null);
  // The server never reuses stored secrets for a different host.
  const urlChanged = stored.base_url !== "" && !sameUrl(baseUrl, stored.base_url);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy("save");
    try {
      await api.putConnection({
        base_url: baseUrl.trim(),
        webhook_url: webhookUrl.trim(),
        api_key: orNull(apiKey),
        webhook_secret: orNull(secret),
      });
      setApiKey("");
      setSecret("");
      onSaved();
      notifySessionsChanged();
      toast.success("Connection saved");
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(null);
    }
  }

  async function runTest() {
    setBusy("test");
    setTest(null);
    try {
      setTest(await api.testConnection({ base_url: orNull(baseUrl), api_key: orNull(apiKey) }));
    } catch (err) {
      setTest({ ok: false, detail: message(err) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <form aria-label="Connection" className="flex flex-col gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="OpenWA base URL" hint={urlChanged ? REENTER : "For example http://openwa:2785"}>
          <Input type="url" dir="ltr" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} required disabled={busy !== null} />
        </Field>
        <Field label="API key">
          <Input
            type="password"
            autoComplete="new-password"
            dir="ltr"
            placeholder={stored.api_key_set ? STORED : undefined}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            disabled={busy !== null}
          />
        </Field>
        <Field label="Webhook URL" hint="Public base URL OpenWA posts events to; the session is appended. Blank skips webhook registration.">
          <Input type="url" dir="ltr" value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} disabled={busy !== null} />
        </Field>
        <Field label="Webhook secret" hint="At least 16 characters. Leave blank to keep the stored secret.">
          <Input
            type="password"
            autoComplete="new-password"
            dir="ltr"
            placeholder={stored.webhook_secret_set ? STORED : undefined}
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            disabled={busy !== null}
          />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={busy !== null}>Save connection</Button>
        <Button type="button" disabled={busy !== null} onClick={() => void runTest()}>Test connection</Button>
      </div>
      {test && (
        <div role="status" aria-label="Connection test" className="flex flex-wrap items-center gap-2 text-sm">
          <Badge tone={test.ok ? "success" : "danger"} icon={test.ok ? CircleCheck : CircleAlert}>{test.ok ? "OK" : "Failed"}</Badge>
          <span className="break-all">{test.detail}</span>
        </div>
      )}
    </form>
  );
}

function Connection() {
  const { data, error, loading, reload } = useLoad(() => api.getConnection(), []);
  const inlineError = useLoadError(error, data !== null);
  return (
    <Section title="Connection" description="Where the OpenWA gateway runs and how it authenticates. Stored secrets are never shown.">
      {inlineError && <InlineError>{inlineError}</InlineError>}
      {/* The form seeds its fields once; later polls only refresh the "stored" hints. */}
      {loading && !data ? <Loading /> : data ? <ConnectionForm stored={data} onSaved={() => void reload()} /> : null}
    </Section>
  );
}

interface RowProps {
  session: SessionInfo;
  busy: boolean;
  run: (task: () => Promise<unknown>, success?: string) => Promise<boolean>;
}

function SessionRow({ session: s, busy, run }: RowProps) {
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(s.label);
  const [openwaId, setOpenwaId] = useState(s.openwa_session_id);

  function startEdit() {
    setLabel(s.label);
    setOpenwaId(s.openwa_session_id);
    setEditing(true);
  }

  async function saveEdit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !openwaId.trim()) return;
    const ok = await run(() => api.patchSession(s.id, { label: label.trim(), openwa_session_id: openwaId.trim() }), "Session saved");
    if (ok) setEditing(false);
  }

  async function remove() {
    const ok = await confirm({
      title: "Delete this session?",
      text: `${s.label} (${s.openwa_session_id}) will be removed. A session that still owns groups can only be disabled.`,
      confirmText: "Delete",
      danger: true,
    });
    if (ok) await run(() => api.deleteSession(s.id), "Session deleted");
  }

  return (
    <li className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="font-medium" dir="auto"><bdi>{s.label}</bdi></strong>
            <Badge tone={s.error ? "danger" : s.enabled ? "info" : "neutral"}>{s.status ?? (s.enabled ? "Unknown" : "Disabled")}</Badge>
          </div>
          <div className="break-all text-xs text-muted-foreground">
            <bdi dir="ltr">{s.openwa_session_id}</bdi> · {s.group_count} {s.group_count === 1 ? "group" : "groups"}
          </div>
          {s.error && <p className="break-all text-xs text-danger">{s.error}</p>}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Switch
            aria-label={`Enable ${s.label}`}
            checked={s.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void run(() => api.patchSession(s.id, { enabled }), enabled ? "Session enabled" : "Session disabled")}
          />
          <span aria-hidden="true">{s.enabled ? "Enabled" : "Disabled"}</span>
        </label>
      </div>
      {editing ? (
        <form aria-label={`Edit ${s.label}`} className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={saveEdit}>
          <Field className="min-w-0 flex-1" label="Label">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} disabled={busy} dir="auto" />
          </Field>
          <Field className="min-w-0 flex-1" label="OpenWA session id">
            <Input value={openwaId} onChange={(e) => setOpenwaId(e.target.value)} required maxLength={255} disabled={busy} dir="ltr" />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" size="lg" disabled={busy}>Save</Button>
            <Button type="button" size="lg" disabled={busy} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="table" aria-label={`Re-register webhook for ${s.label}`} disabled={busy} onClick={() => void run(() => api.registerWebhook(s.id), "Webhook registered")}>
            Re-register webhook
          </Button>
          <Button size="table" aria-label={`Edit ${s.label}`} disabled={busy} onClick={startEdit}>Edit</Button>
          <Button size="table" variant="danger-outline" aria-label={`Delete ${s.label}`} disabled={busy} onClick={() => void remove()}>Delete</Button>
        </div>
      )}
    </li>
  );
}

function Sessions() {
  const { data, error, loading, reload } = useLoad(() => api.listSessions(), []);
  const inlineError = useLoadError(error, data !== null);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState("");
  const [openwaId, setOpenwaId] = useState("");

  /** Run a mutation; failures (e.g. the 409 on delete) are toasted. Always reloads. */
  async function run(task: () => Promise<unknown>, success?: string): Promise<boolean> {
    setBusy(true);
    let ok = false;
    try {
      await task();
      ok = true;
      if (success) toast.success(success);
    } catch (err) {
      toast.error(message(err));
    } finally {
      setBusy(false);
    }
    notifySessionsChanged();
    await reload();
    return ok;
  }

  async function add(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !openwaId.trim()) return;
    const ok = await run(() => api.createSession({ label: label.trim(), openwa_session_id: openwaId.trim() }), "Session added");
    if (ok) {
      setLabel("");
      setOpenwaId("");
    }
  }

  return (
    <Section title="Sessions" description="WhatsApp sessions on the OpenWA gateway. Each one has its own groups and messages.">
      {inlineError && <InlineError>{inlineError}</InlineError>}
      {loading && !data ? <Loading /> : data && data.length === 0 ? (
        <div className="rounded-lg border">
          <EmptyState icon={Smartphone} title="No sessions yet.">Add the OpenWA session the bot should use.</EmptyState>
        </div>
      ) : data ? (
        <ul role="list" aria-label="Sessions" className="m-0 list-none divide-y overflow-hidden rounded-lg border p-0">
          {data.map((s) => <SessionRow key={s.id} session={s} busy={busy} run={run} />)}
        </ul>
      ) : null}
      <form aria-label="Add session" className="flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={add}>
        <Field className="min-w-0 flex-1" label="Label">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} required maxLength={100} disabled={busy} dir="auto" />
        </Field>
        <Field className="min-w-0 flex-1" label="OpenWA session id">
          <Input value={openwaId} onChange={(e) => setOpenwaId(e.target.value)} required maxLength={255} disabled={busy} dir="ltr" />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy}>Add session</Button>
      </form>
    </Section>
  );
}

export default function Settings() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Settings" description="The OpenWA connection and the WhatsApp sessions the bot serves." />
      <Connection />
      <Sessions />
    </div>
  );
}
