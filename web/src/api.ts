import { getSessionId } from "./session";
import type {
  ActionName, Actions, ConnectionSettings, ConnectionTestRequest, ConnectionTestResult, ConnectionUpdate,
  Contact, Group, GroupPatch, GroupSort, MessagePage, OptOutItem, Page, Schedule, ScheduleCreate,
  ScheduleList, SchedulePatch, SessionCreate, SessionInfo, SessionPatch, Stats,
} from "./types";

const BASE = "/api/v1/admin";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

const GLOBAL_PREFIXES = ["/settings", "/auth"];
/** `path` is `prefix` itself or below it (whole segments: "/settingsfoo" is not). */
const under = (path: string, prefix: string) =>
  path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`);

/** Data calls carry the selected session; settings and auth calls are global. */
export function withSession(path: string): string {
  const id = getSessionId();
  if (!id || GLOBAL_PREFIXES.some((prefix) => under(path, prefix))) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${new URLSearchParams({ session_id: id })}`;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { "X-Requested-With": "admin-ui" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const res = await fetch(`${BASE}${withSession(path)}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      if (typeof data?.detail === "string") message = data.detail;
      else if (Array.isArray(data?.detail)) message = data.detail.map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d)).join("; ");
    } catch {
      /* non-JSON error body */
    }
    if (res.status === 401 && path !== "/auth/login") onUnauthorized?.();
    throw new ApiError(res.status, message || `HTTP ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function qs(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") sp.set(key, String(value));
  }
  const text = sp.toString();
  return text ? `?${text}` : "";
}

export const api = {
  getStats: (p: { from?: string; to?: string }) => request<Stats>("GET", `/stats${qs(p)}`),

  session: () => request<{ authenticated: boolean }>("GET", "/auth/session"),
  login: (password: string) => request<void>("POST", "/auth/login", { password }),
  logout: () => request<void>("POST", "/auth/logout"),

  listGroups: (p: { search?: string; managed?: boolean; sort?: GroupSort; limit?: number; offset?: number }) =>
    request<Page<Group>>("GET", `/groups${qs(p)}`),
  patchGroup: (jid: string, patch: GroupPatch) =>
    request<Group>("PATCH", `/groups/${encodeURIComponent(jid)}`, patch),

  listSchedules: (jid: string) =>
    request<ScheduleList>("GET", `/groups/${encodeURIComponent(jid)}/schedules`),
  createSchedule: (jid: string, body: ScheduleCreate) =>
    request<Schedule>("POST", `/groups/${encodeURIComponent(jid)}/schedules`, body),
  patchSchedule: (jid: string, id: string, patch: SchedulePatch) =>
    request<Schedule>("PATCH", `/groups/${encodeURIComponent(jid)}/schedules/${encodeURIComponent(id)}`, patch),
  deleteSchedule: (jid: string, id: string) =>
    request<void>("DELETE", `/groups/${encodeURIComponent(jid)}/schedules/${encodeURIComponent(id)}`),

  listContacts: (p: { search?: string; opted_out?: boolean; limit?: number; offset?: number }) =>
    request<Page<Contact>>("GET", `/contacts${qs(p)}`),
  patchContact: (jid: string, push_name: string | null) =>
    request<Contact>("PATCH", `/contacts/${encodeURIComponent(jid)}`, { push_name }),

  listOptOuts: () => request<OptOutItem[]>("GET", "/opt-outs"),
  addOptOut: (jid: string) => request<OptOutItem>("POST", "/opt-outs", { jid }),
  removeOptOut: (jid: string) => request<void>("DELETE", `/opt-outs/${encodeURIComponent(jid)}`),

  listMessages: (p: { group_jid?: string; sender_jid?: string; q?: string; from?: string; to?: string; limit?: number; before?: string }) =>
    request<MessagePage>("GET", `/messages${qs(p)}`),

  getConnection: () => request<ConnectionSettings>("GET", "/settings/connection"),
  putConnection: (body: ConnectionUpdate) => request<ConnectionSettings>("PUT", "/settings/connection", body),
  testConnection: (body: ConnectionTestRequest) =>
    request<ConnectionTestResult>("POST", "/settings/connection/test", body),
  listSessions: () => request<SessionInfo[]>("GET", "/settings/sessions"),
  createSession: (body: SessionCreate) => request<SessionInfo>("POST", "/settings/sessions", body),
  patchSession: (id: string, patch: SessionPatch) =>
    request<SessionInfo>("PATCH", `/settings/sessions/${encodeURIComponent(id)}`, patch),
  deleteSession: (id: string) => request<void>("DELETE", `/settings/sessions/${encodeURIComponent(id)}`),
  registerWebhook: (id: string) =>
    request<{ registered: boolean }>("POST", `/settings/sessions/${encodeURIComponent(id)}/webhook`),

  getActions: () => request<Actions>("GET", "/actions"),
  runAction: (name: ActionName) =>
    request<{ job_id: string }>("POST", `/actions/${name === "load_kb" ? "load-kb" : name}`),
};
