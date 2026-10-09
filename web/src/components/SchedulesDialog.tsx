import { useEffect, useRef, useState } from "react";
import { api } from "../api";
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
  const closeBtn = useRef<HTMLButtonElement>(null);
  const confirming = useRef(false);
  const busy = rows.some((r) => r.saving);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const close = () => {
    if (!busyRef.current && !confirming.current) onClose();
  };
  const closeRef = useRef(close);
  closeRef.current = close;

  useEffect(() => {
    let live = true;
    api.listSchedules(group.group_jid).then(
      (res) => {
        if (!live) return;
        setTimezone(res.timezone);
        setRows(res.items.map((s) => fromSchedule(s, nextKey())));
        setLoading(false);
      },
      (e) => {
        if (!live) return;
        setLoadError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      },
    );
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group.group_jid]);

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
      if (e.key === "Escape" && !document.querySelector(".swal2-container")) closeRef.current();
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
    ).filter((el) => !(el as HTMLButtonElement).disabled);
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
      setRows((rs) => rs.map((r) => (r.key === row.key ? fromSchedule(saved, r.key) : r)));
      toast.success(`Saved schedule for ${group.label}`);
      if (!row.base) onChanged();
    } catch (e) {
      update(row.key, { saving: false });
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(row: Row) {
    if (!row.base) {
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
      setRows((rs) => rs.filter((r) => r.key !== row.key));
      toast.success(`Deleted schedule for ${group.label}`);
      onChanged();
    } catch (e) {
      update(row.key, { saving: false });
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div ref={backdrop} className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal modal-wide" role="dialog" aria-modal="true" aria-labelledby="schedules-title" onKeyDown={trapTab}>
        <h2 id="schedules-title">Schedules: <bdi>{group.label}</bdi></h2>
        {timezone && <p className="muted">Times use the server time zone: <strong>{timezone}</strong></p>}
        {!group.managed && <p className="notice" role="note">Schedules only run for managed groups.</p>}
        {loading && <p className="muted" role="status">Loading…</p>}
        {loadError && <p role="alert" className="inline-error">{loadError}</p>}
        {!loading && !loadError && rows.length === 0 && <p className="muted">No schedules yet.</p>}
        <ul className="schedule-list">
          {rows.map((row, index) => {
            const b = row.base;
            const dirty = !b || Object.keys(changes(row) ?? {}).length > 0;
            const reason = b ? describeReason(b.last_reason) : null;
            return (
              <li key={row.key} className="schedule-row" role="group" aria-label={`Schedule ${index + 1}`}>
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
                  <button type="button" className="primary" onClick={() => void save(row)} disabled={row.saving || !dirty} aria-label={`Save schedule ${index + 1}`}>Save</button>
                  <button type="button" onClick={() => void remove(row)} disabled={row.saving} aria-label={`${b ? "Delete" : "Remove"} schedule ${index + 1}`}>{b ? "Delete" : "Remove"}</button>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="toolbar">
          <button type="button" onClick={addRow} disabled={loading || !!loadError || rows.length >= MAX_SCHEDULES}>Add schedule</button>
          {rows.length >= MAX_SCHEDULES && <span className="muted">Limit of {MAX_SCHEDULES} schedules reached.</span>}
          <button ref={closeBtn} type="button" onClick={close} disabled={busy}>Close</button>
        </div>
      </div>
    </div>
  );
}
