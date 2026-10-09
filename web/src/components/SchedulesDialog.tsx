import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { confirm, toast } from "../alerts";
import type { Meridiem, Schedule, ScheduleStatus } from "../types";
import { Badge, type Tone } from "./ui/badge";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { Select } from "./ui/field";
import { InlineError } from "./ui/inline-error";
import { Switch } from "./ui/switch";
import { useReturnFocus } from "./useReturnFocus";

export const MAX_SCHEDULES = 20;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = Array.from({ length: 12 }, (_, i) => i + 1);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);
const pad = (n: number) => String(n).padStart(2, "0");

const REASONS: Record<string, string> = {
  not_enough_messages: "Not enough new messages",
  group_not_managed: "Group is not managed",
  unexpected_error: "Unexpected error",
  timeout: "Timed out",
  lock_timeout: "Another summary was still running",
};

/** Friendly wording for a stored reason code. */
export function describeReason(reason: string | null): string | null {
  if (!reason) return null;
  return REASONS[reason] ?? reason.replace(/_/g, " ");
}

const TONE: Record<ScheduleStatus, Tone> = { sent: "success", skipped: "warning", failed: "danger" };

interface Row {
  key: string;
  base: Schedule | null; // null = not saved yet
  weekdays: number[];
  hour12: number;
  meridiem: Meridiem;
  minute: number;
  enabled: boolean;
  saving: boolean;
  attempted: boolean; // a save was tried (drives the inline validation message)
}

function fromSchedule(s: Schedule, key: string): Row {
  return {
    key, base: s, weekdays: [...s.weekdays].sort((a, b) => a - b), hour12: s.hour12, meridiem: s.meridiem,
    minute: s.minute, enabled: s.enabled, saving: false, attempted: false,
  };
}

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

/** Fields that differ from the saved schedule. The time is always sent as the full 12-hour form. */
function changes(row: Row) {
  const b = row.base;
  if (!b) return null;
  const out: { weekdays?: number[]; hour12?: number; meridiem?: Meridiem; minute?: number; enabled?: boolean } = {};
  if (!sameDays(row.weekdays, [...b.weekdays].sort((x, y) => x - y))) out.weekdays = row.weekdays;
  if (row.hour12 !== b.hour12 || row.meridiem !== b.meridiem || row.minute !== b.minute) {
    out.hour12 = row.hour12;
    out.meridiem = row.meridiem;
    out.minute = row.minute;
  }
  if (row.enabled !== b.enabled) out.enabled = row.enabled;
  return out;
}

function fmt(ts: string): string {
  return new Date(ts).toLocaleString();
}

function summary(row: Row): string {
  const days = row.weekdays.map((d) => DAYS[d]).join(", ") || "no days";
  return `${days} at ${row.hour12}:${pad(row.minute)} ${row.meridiem}`;
}

const isDirty = (r: Row) => !!r.base && Object.keys(changes(r) ?? {}).length > 0;

/**
 * Merge a fresh server list into the local rows by schedule id. Rows being saved or holding
 * unsaved edits are left alone, clean rows are refreshed in place (same key, no remount), unknown
 * server items are appended, and unsaved new rows stay last.
 */
function mergeServer(rs: Row[], items: Schedule[], nextKey: () => string): Row[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const localIds = new Set(rs.filter((r) => r.base).map((r) => r.base!.id));
  const saved: Row[] = [];
  for (const r of rs) {
    if (!r.base) continue;
    const item = byId.get(r.base.id);
    if (r.saving || isDirty(r)) saved.push(r);
    else if (item) saved.push(fromSchedule(item, r.key));
  }
  for (const item of items) if (!localIds.has(item.id)) saved.push(fromSchedule(item, nextKey()));
  return [...saved, ...rs.filter((r) => !r.base)];
}

const timeText = (h12: number, minute: number, mer: Meridiem) => `${h12}:${pad(minute)} ${mer}`;

/** Accessible names: saved rows by their saved time, unsaved ones as "new schedule"; a number only breaks ties. */
function rowNames(rows: Row[]): string[] {
  const base = rows.map((r) => (r.base ? `schedule at ${timeText(r.base.hour12, r.base.minute, r.base.meridiem)}` : "new schedule"));
  const total: Record<string, number> = {};
  for (const n of base) total[n] = (total[n] ?? 0) + 1;
  const seen: Record<string, number> = {};
  return base.map((n) => {
    if (total[n] === 1) return n;
    seen[n] = (seen[n] ?? 0) + 1;
    return `${n} (${seen[n]})`;
  });
}

export interface SchedulesGroup {
  group_jid: string;
  label: string;
  managed: boolean;
}

interface Props {
  group: SchedulesGroup;
  onClose: () => void;
  /** Called after a schedule was created or deleted so the caller can refresh counts. */
  onChanged: () => void;
  /** Where focus goes after the dialog closes (default: the element focused when it opened). */
  returnFocus?: () => void;
}

/** Day toggles look like chips; the native checkbox keeps its role, name and keyboard behaviour. */
const DAY_CHIP =
  "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md border border-border-strong bg-surface px-2.5 text-sm font-medium md:min-h-9 has-[:checked]:border-primary has-[:checked]:bg-primary-soft has-[:checked]:text-primary has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60";
/** Compact selects in the time row; still 44px tall on phones. */
const TIME_SELECT = "w-[4.75rem] md:min-h-9";

export default function SchedulesDialog({ group, onClose, onChanged, returnFocus }: Props) {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const keySeq = useRef(0);
  const nextKey = () => `r${++keySeq.current}`;

  const idPrefix = useId();
  const dialogEl = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const onCloseAutoFocus = useReturnFocus(returnFocus);
  // Where focus should go after the next render: a row key, "add" or "first".
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const confirming = useRef(false);
  const busy = rows.some((r) => r.saving);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const close = () => {
    if (!busyRef.current && !confirming.current) onClose();
  };

  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  /** Fetch the list. Saved rows are replaced by server state; unsaved rows are kept. */
  async function loadList(initial: boolean) {
    try {
      const res = await api.listSchedules(group.group_jid);
      if (!live.current) return;
      setTimezone(res.timezone);
      setRows((rs) => mergeServer(rs, res.items, nextKey));
      setLoadError(null);
    } catch (e) {
      if (!live.current) return;
      if (initial) setLoadError(e instanceof Error ? e.message : String(e));
      else toast.error(e instanceof Error ? e.message : String(e));
    }
    if (initial) {
      setLoading(false);
      setFocusTo("first");
    }
  }

  useEffect(() => {
    void loadList(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.group_jid]);

  useLayoutEffect(() => {
    if (!focusTo || loading) return;
    const root = dialogEl.current;
    if (!root) return;
    let target: HTMLElement | null = null;
    if (focusTo === "add") target = addBtn.current;
    else {
      const row = focusTo === "first" ? root.querySelector<HTMLElement>("[data-row-key]") : root.querySelector<HTMLElement>(`[data-row-key="${focusTo}"]`);
      target = row?.querySelector<HTMLElement>("input:not(:disabled)") ?? (focusTo === "first" ? addBtn.current : null);
    }
    (target ?? addBtn.current)?.focus();
    setFocusTo(null);
  }, [focusTo, loading, rows]);

  const update = (key: string, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  function toggleDay(row: Row, day: number) {
    const weekdays = row.weekdays.includes(day) ? row.weekdays.filter((d) => d !== day) : [...row.weekdays, day].sort((a, b) => a - b);
    update(row.key, { weekdays });
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      { key: nextKey(), base: null, weekdays: [], hour12: 9, meridiem: "AM", minute: 0, enabled: true, saving: false, attempted: false },
    ]);
  }

  async function save(row: Row) {
    if (row.weekdays.length === 0) {
      update(row.key, { attempted: true });
      return;
    }
    update(row.key, { saving: true });
    try {
      let saved: Schedule;
      if (row.base) {
        const patch = changes(row)!;
        if (Object.keys(patch).length === 0) {
          update(row.key, { saving: false });
          return;
        }
        saved = await api.patchSchedule(group.group_jid, row.base.id, patch);
      } else {
        saved = await api.createSchedule(group.group_jid, {
          weekdays: row.weekdays, hour12: row.hour12, meridiem: row.meridiem, minute: row.minute, enabled: row.enabled,
        });
      }
      setRows((rs) =>
        rs
          .filter((r) => r.key === row.key || r.base?.id !== saved.id) // collapse a copy a reload already added
          .map((r) => (r.key === row.key ? fromSchedule(saved, r.key) : r)),
      );
      toast.success(`Saved schedule for ${group.label}`);
      if (!row.base) onChanged();
    } catch (e) {
      handleFailure(row, e);
    }
  }

  /** 404: the schedule is gone, drop it. 409: state changed elsewhere, reload. Otherwise keep the draft. */
  function handleFailure(row: Row, e: unknown) {
    const status = e instanceof ApiError ? e.status : null;
    const message = e instanceof Error ? e.message : String(e);
    if (status === 404 && row.base) {
      focusAfterRemoval(row);
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      toast.info("This schedule no longer exists");
      onChanged();
      return;
    }
    update(row.key, { saving: false });
    toast.error(message);
    if (status === 409) {
      void loadList(false);
      onChanged();
    }
  }

  function focusAfterRemoval(row: Row) {
    const i = rows.findIndex((r) => r.key === row.key);
    const next = rows[i + 1] ?? rows[i - 1];
    setFocusTo(next ? next.key : "add");
  }

  async function remove(row: Row) {
    if (!row.base) {
      focusAfterRemoval(row);
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      return;
    }
    confirming.current = true;
    let ok = false;
    try {
      ok = await confirm({
        title: "Delete this schedule?",
        text: `${summary(row)} in ${group.label}`,
        confirmText: "Delete",
        danger: true,
      });
    } finally {
      confirming.current = false;
    }
    if (!ok) return;
    update(row.key, { saving: true });
    try {
      await api.deleteSchedule(group.group_jid, row.base.id);
      focusAfterRemoval(row);
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      toast.success(`Deleted schedule for ${group.label}`);
      onChanged();
    } catch (e) {
      handleFailure(row, e);
    }
  }

  const names = rowNames(rows);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent
        wide
        title={<>Schedules: <bdi>{group.label}</bdi></>}
        closeDisabled={busy}
        // While the delete confirm is pending, Escape belongs to it (SweetAlert popups are also
        // guarded inside DialogContent).
        onEscapeKeyDown={(e) => { if (confirming.current) e.preventDefault(); }}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <div ref={dialogEl} className="flex flex-col gap-4">
          {timezone && (
            <p className="text-sm text-muted-foreground">
              Times use the server time zone: <strong className="font-medium text-foreground">{timezone}</strong>
            </p>
          )}
          {!group.managed && <p className="rounded-md bg-warning-soft p-3 text-sm text-warning" role="note">Schedules only run for managed groups.</p>}
          {loading && <p className="text-sm text-muted-foreground" role="status">Loading…</p>}
          {loadError && <InlineError>{loadError}</InlineError>}
          {!loading && !loadError && rows.length === 0 && <p className="text-sm text-muted-foreground">No schedules yet.</p>}
          <ul role="list" aria-label="Schedules" className="m-0 flex list-none flex-col gap-3 p-0">
            {rows.map((row, index) => {
              const name = names[index];
              const b = row.base;
              const dirty = !b || Object.keys(changes(row) ?? {}).length > 0;
              const reason = b ? describeReason(b.last_reason) : null;
              const enabledId = `${idPrefix}-${row.key}-enabled`;
              return (
                <li
                  key={row.key}
                  className="flex flex-col gap-3 rounded-lg border border-border bg-surface-2/40 p-3 md:p-4"
                  role="group"
                  data-row-key={row.key}
                  aria-label={name.charAt(0).toUpperCase() + name.slice(1)}
                >
                  <fieldset className="m-0 flex min-w-0 flex-wrap gap-1.5 border-0 p-0" disabled={row.saving}>
                    <legend className="sr-only">Days</legend>
                    {DAYS.map((day, i) => (
                      <label key={day} className={DAY_CHIP}>
                        <input type="checkbox" className="size-4 accent-primary" checked={row.weekdays.includes(i)} disabled={row.saving} onChange={() => toggleDay(row, i)} />
                        <span>{day}</span>
                      </label>
                    ))}
                  </fieldset>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                    <div className="flex items-center gap-1.5" dir="ltr">
                      <Select aria-label="Hour" className={TIME_SELECT} value={row.hour12} disabled={row.saving} onChange={(e) => update(row.key, { hour12: Number(e.target.value) })}>
                        {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                      </Select>
                      <span aria-hidden="true" className="font-medium">:</span>
                      <Select aria-label="Minute" className={TIME_SELECT} value={row.minute} disabled={row.saving} onChange={(e) => update(row.key, { minute: Number(e.target.value) })}>
                        {MINUTES.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                      </Select>
                      <Select aria-label="AM or PM" className={TIME_SELECT} value={row.meridiem} disabled={row.saving} onChange={(e) => update(row.key, { meridiem: e.target.value as Meridiem })}>
                        <option value="AM">AM</option>
                        <option value="PM">PM</option>
                      </Select>
                    </div>
                    <div className="flex min-h-11 items-center gap-3">
                      <Switch id={enabledId} checked={row.enabled} disabled={row.saving} onCheckedChange={(enabled) => update(row.key, { enabled })} />
                      <label htmlFor={enabledId} className="text-sm font-medium">Enabled</label>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 break-words text-xs text-muted-foreground">
                    {b?.last_run_at && b.last_status ? (
                      <>
                        Last run {fmt(b.last_run_at)}{" "}
                        <Badge tone={TONE[b.last_status] ?? "neutral"}>{b.last_status}</Badge>
                        {reason && <> {reason}</>}
                        {b.last_message_count != null && <> ({b.last_message_count} {b.last_message_count === 1 ? "message" : "messages"})</>}
                      </>
                    ) : (
                      "Never run"
                    )}
                  </div>
                  {row.weekdays.length === 0 && row.attempted && <InlineError>Select at least one day.</InlineError>}
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant={b ? "danger-outline" : "outline"} size="sm" className="min-h-11 md:min-h-9" onClick={() => void remove(row)} disabled={row.saving} aria-label={`${b ? "Delete" : "Remove"} ${name}`}>
                      {b ? "Delete" : "Remove"}
                    </Button>
                    <Button variant="primary" size="sm" className="min-h-11 md:min-h-9" onClick={() => void save(row)} disabled={row.saving || !dirty} aria-label={`Save ${name}`}>
                      Save
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button ref={addBtn} size="lg" className="md:min-h-10 md:text-sm" onClick={addRow} disabled={loading || !!loadError || rows.length >= MAX_SCHEDULES}>
              Add schedule
            </Button>
            {rows.length >= MAX_SCHEDULES && <span className="text-sm text-muted-foreground">Limit of {MAX_SCHEDULES} schedules reached.</span>}
            <Button variant="primary" size="lg" className="ms-auto md:min-h-10 md:text-sm" onClick={close} disabled={busy}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
