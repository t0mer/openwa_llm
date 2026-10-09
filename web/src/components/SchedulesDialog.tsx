import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, ApiError } from "../api";
import { confirm, toast } from "../alerts";
import type { Meridiem, Schedule, ScheduleStatus } from "../types";

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

const BADGE: Record<ScheduleStatus, string> = { sent: "ok", skipped: "warn", failed: "bad" };

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
}

export default function SchedulesDialog({ group, onClose, onChanged }: Props) {
  const [timezone, setTimezone] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const keySeq = useRef(0);
  const nextKey = () => `r${++keySeq.current}`;

  const backdrop = useRef<HTMLDivElement>(null);
  const dialogEl = useRef<HTMLDivElement>(null);
  const addBtn = useRef<HTMLButtonElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  // Where focus should go after the next render: a row key, "add" or "first".
  const [focusTo, setFocusTo] = useState<string | null>(null);
  const confirming = useRef(false);
  const busy = rows.some((r) => r.saving);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const close = () => {
    if (!busyRef.current && !confirming.current) onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

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
      const row = focusTo === "first" ? root.querySelector<HTMLElement>(".schedule-row") : root.querySelector<HTMLElement>(`[data-row-key="${focusTo}"]`);
      target = row?.querySelector<HTMLElement>("input:not(:disabled)") ?? (focusTo === "first" ? addBtn.current : null);
    }
    (target ?? addBtn.current)?.focus();
    setFocusTo(null);
  }, [focusTo, loading, rows]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const inerted: Element[] = [];
    for (let node: Element | null = backdrop.current; node && node !== document.body; node = node.parentElement) {
      for (const sib of Array.from(node.parentElement?.children ?? [])) {
        if (sib !== node && !sib.hasAttribute("inert")) {
          sib.setAttribute("inert", "");
          inerted.push(sib);
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector(".swal2-popup:not(.swal2-toast)")) closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      for (const el of inerted) el.removeAttribute("inert");
      opener?.focus?.();
    };
  }, []);

  function trapTab(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      e.currentTarget.querySelectorAll<HTMLElement>("button, input, select, textarea, a[href], [tabindex]:not([tabindex='-1'])"),
    ).filter((el) => !el.matches(":disabled"));
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !e.currentTarget.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !e.currentTarget.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  }

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
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div ref={dialogEl} className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedules-title" onKeyDown={trapTab}>
        <h2 id="schedules-title">Schedules: <bdi>{group.label}</bdi></h2>
        {timezone && <p className="muted">Times use the server time zone: <strong>{timezone}</strong></p>}
        {!group.managed && <p className="notice" role="note">Schedules only run for managed groups.</p>}
        {loading && <p className="muted" role="status">Loading…</p>}
        {loadError && <p role="alert" className="inline-error">{loadError}</p>}
        {!loading && !loadError && rows.length === 0 && <p className="muted">No schedules yet.</p>}
        <ul className="schedule-list">
          {rows.map((row, index) => {
            const name = names[index];
            const b = row.base;
            const dirty = !b || Object.keys(changes(row) ?? {}).length > 0;
            const reason = b ? describeReason(b.last_reason) : null;
            return (
              <li key={row.key} className="schedule-row" role="group" data-row-key={row.key} aria-label={name.charAt(0).toUpperCase() + name.slice(1)}>
                <fieldset className="schedule-days" disabled={row.saving}>
                  <legend className="sr-only">Days</legend>
                  {DAYS.map((name, day) => (
                    <label key={name} className="day">
                      <input type="checkbox" checked={row.weekdays.includes(day)} onChange={() => toggleDay(row, day)} />
                      <span>{name}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="schedule-time">
                  <select aria-label="Hour" value={row.hour12} disabled={row.saving} onChange={(e) => update(row.key, { hour12: Number(e.target.value) })}>
                    {HOURS.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                  <span aria-hidden="true">:</span>
                  <select aria-label="Minute" value={row.minute} disabled={row.saving} onChange={(e) => update(row.key, { minute: Number(e.target.value) })}>
                    {MINUTES.map((m) => <option key={m} value={m}>{pad(m)}</option>)}
                  </select>
                  <select aria-label="AM or PM" value={row.meridiem} disabled={row.saving} onChange={(e) => update(row.key, { meridiem: e.target.value as Meridiem })}>
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                  <label className="schedule-enabled">
                    <input type="checkbox" className="switch" checked={row.enabled} disabled={row.saving} onChange={(e) => update(row.key, { enabled: e.target.checked })} />
                    <span>Enabled</span>
                  </label>
                </div>
                <div className="schedule-last muted">
                  {b?.last_run_at && b.last_status ? (
                    <>
                      Last run {fmt(b.last_run_at)}{" "}
                      <span className={`badge ${BADGE[b.last_status] ?? ""}`}>{b.last_status}</span>
                      {reason && <> {reason}</>}
                      {b.last_message_count != null && <> ({b.last_message_count} {b.last_message_count === 1 ? "message" : "messages"})</>}
                    </>
                  ) : (
                    "Never run"
                  )}
                </div>
                {row.weekdays.length === 0 && row.attempted && (
                  <p role="alert" className="inline-error">Select at least one day.</p>
                )}
                <div className="schedule-actions">
                  <button type="button" className="primary" onClick={() => void save(row)} disabled={row.saving || !dirty} aria-label={`Save ${name}`}>Save</button>
                  <button type="button" onClick={() => void remove(row)} disabled={row.saving} aria-label={`${b ? "Delete" : "Remove"} ${name}`}>{b ? "Delete" : "Remove"}</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="toolbar">
          <button ref={addBtn} type="button" onClick={addRow} disabled={loading || !!loadError || rows.length >= MAX_SCHEDULES}>Add schedule</button>
          {rows.length >= MAX_SCHEDULES && <span className="muted">Limit of {MAX_SCHEDULES} schedules reached.</span>}
          <button ref={closeBtn} type="button" onClick={close} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
