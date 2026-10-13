import { Fragment, createElement, useSyncExternalStore, type ReactNode } from "react";

/** localStorage key for the selected WhatsApp session (a per-browser convenience). */
export const SESSION_KEY = "admin-session";

function readStored(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY) || null;
  } catch {
    return null; // private mode / blocked storage
  }
}

let current: string | null = readStored();
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** The selected session's id, or null when none is selected. */
export function getSessionId(): string | null {
  return current;
}

export function setSessionId(id: string | null): void {
  const next = id || null;
  if (next === current) return;
  current = next;
  try {
    if (next) localStorage.setItem(SESSION_KEY, next);
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* storage unavailable: the selection lives for this page load only */
  }
  for (const fn of listeners) fn();
}

export function useSessionId(): string | null {
  return useSyncExternalStore(subscribe, getSessionId);
}

let sessionsVersion = 0;
const versionListeners = new Set<() => void>();

/** Tell the session switcher that sessions were added, changed or removed. */
export function notifySessionsChanged(): void {
  sessionsVersion++;
  for (const fn of versionListeners) fn();
}

export function useSessionsVersion(): number {
  return useSyncExternalStore(
    (fn) => {
      versionListeners.add(fn);
      return () => {
        versionListeners.delete(fn);
      };
    },
    () => sessionsVersion,
  );
}

/** Remounts a session-scoped page when the selected session changes, so it loads afresh. */
export function SessionScoped({ children }: { children: ReactNode }) {
  return createElement(Fragment, { key: useSessionId() ?? "" }, children);
}
