export interface Page<T> {
  items: T[];
  total: number;
}

export interface Group {
  group_jid: string;
  group_name: string | null;
  display_name: string | null;
  group_topic: string | null;
  owner_jid: string | null;
  managed: boolean;
  notify_on_spam: boolean;
  community_keys: string[];
  last_summary_sync: string;
  last_ingest: string;
  message_count: number;
}

export interface GroupPatch {
  managed?: boolean;
  notify_on_spam?: boolean;
  community_keys?: string[];
  display_name?: string | null;
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

export interface ActionStatus {
  state: "idle" | "running" | "succeeded" | "failed";
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
}

export type Actions = Record<ActionName, ActionStatus>;
