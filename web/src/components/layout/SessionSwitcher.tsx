import { Settings as SettingsIcon, Smartphone } from "lucide-react";
import { useEffect } from "react";
import { Link } from "react-router-dom";
import { api } from "../../api";
import { setSessionId, useSessionId, useSessionsVersion } from "../../session";
import type { SessionInfo } from "../../types";
import { useLoad } from "../../useLoad";
import { Select } from "../ui/field";

/** The session to fall back to: the first enabled one without an error, else the first enabled one. */
function fallback(sessions: SessionInfo[]): string | null {
  const enabled = sessions.filter((s) => s.enabled);
  return (enabled.find((s) => !s.error) ?? enabled[0])?.id ?? null;
}

/** Picks the WhatsApp session that session-scoped pages (Dashboard, Groups, Messages) show. */
export function SessionSwitcher() {
  const version = useSessionsVersion();
  const { data } = useLoad(() => api.listSessions(), [version]);
  const selected = useSessionId();
  const sessions = Array.isArray(data) ? data : null;

  useEffect(() => {
    if (!sessions) return;
    const valid = sessions.some((s) => s.enabled && s.id === selected);
    if (!valid) setSessionId(fallback(sessions));
  }, [sessions, selected]);

  if (!sessions) return null;

  if (!sessions.some((s) => s.enabled)) {
    return (
      <Link to="/settings" className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-primary underline-offset-4 hover:underline">
        <SettingsIcon aria-hidden="true" className="size-4" />
        {sessions.length === 0 ? "No sessions configured" : "No enabled sessions"}
      </Link>
    );
  }

  if (sessions.length === 1) {
    return (
      <p className="flex min-h-10 items-center gap-2 text-sm text-muted-foreground">
        <Smartphone aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">Session: </span>
        <bdi dir="auto" className="font-medium text-foreground">{sessions[0].label}</bdi>
      </p>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
      <Smartphone aria-hidden="true" className="size-4 shrink-0" />
      <span aria-hidden="true">Session</span>
      <Select aria-label="Session" className="w-auto min-w-40" value={selected ?? ""} onChange={(e) => setSessionId(e.target.value)}>
        {sessions.map((s) => (
          <option key={s.id} value={s.id} disabled={!s.enabled}>
            {s.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
