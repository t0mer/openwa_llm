export interface Page<T> {
  items: T[];
  total: number;
}

export type SummaryLanguage = "he" | "en" | "ru";

export interface Group {
  group_jid: string;
  group_name: string | null;
  display_name: string | null;
  group_topic: string | null;
  owner_jid: string | null;
  managed: boolean;
  notify_on_spam: boolean;
  summary_language: SummaryLanguage | null;
  community_keys: string[];
  last_summary_sync: string;
  last_ingest: string;
  message_count: number;
  schedule_count: number;
}

export interface GroupPatch {
  managed?: boolean;
  notify_on_spam?: boolean;
  community_keys?: string[];
  display_name?: string | null;
  summary_language?: SummaryLanguage | null;
}

export type GroupSort =
  | "name" | "-name"
  | "last_summary_sync" | "-last_summary_sync"
  | "message_count" | "-message_count"
  | "created_at" | "-created_at";

export interface Contact {
  jid: string;
  push_name: string | null;
  opted_out: boolean;
}

export interface OptOutItem {
  jid: string;
  push_name: string | null;
  created_at: string;
}

export interface MessageItem {
  message_id: string;
  timestamp: string;
  text: string | null;
  sender_jid: string;
  sender_name: string | null;
  group_jid: string | null;
  chat_jid: string;
  reply_to_id: string | null;
  reaction_count: number;
  has_media: boolean;
}

export interface MessagePage {
  items: MessageItem[];
  next_cursor: string | null;
}

export type ActionName = "summarize" | "load_kb";

export interface GroupActionResult {
  group_name: string;
  group_jid: string;
  status: "sent" | "skipped" | "failed";
  reason: string | null;
  message_count: number | null;
  required: number | null;
}

export interface ActionSummary {
  managed_groups: number;
  message: string | null;
}

export interface ActionStatus {
  state: "idle" | "running" | "succeeded" | "failed";
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  /** Present for the summarize action on servers that report per-group results. */
  summary?: ActionSummary | null;
  results?: GroupActionResult[];
}

export type Actions = Record<ActionName, ActionStatus>;

export type Meridiem = "AM" | "PM";
export type ScheduleStatus = "sent" | "skipped" | "failed";

/** Weekdays are 0 = Sunday .. 6 = Saturday. */
export interface Schedule {
  id: string;
  weekdays: number[];
  hour: number;
  minute: number;
  hour12: number;
  meridiem: Meridiem;
  enabled: boolean;
  last_run_at: string | null;
  last_status: ScheduleStatus | null;
  last_reason: string | null;
  last_message_count: number | null;
}

export interface ScheduleList {
  timezone: string;
  items: Schedule[];
}

export interface ScheduleCreate {
  weekdays: number[];
  hour12: number;
  meridiem: Meridiem;
  minute: number;
  enabled: boolean;
}

export type SchedulePatch = Partial<ScheduleCreate>;
