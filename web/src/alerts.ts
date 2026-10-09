import Swal from "sweetalert2";
import { describeResult } from "./results";
import type { GroupActionResult } from "./types";

/*
 * SECURITY RULE: SweetAlert2 renders `title`, `html` and `footer` as HTML. Group names, JIDs,
 * push names, error strings and job results are attacker-controllable (any group member can pick
 * a name like `<img src=x onerror=...>`). Never pass interpolated data through those options.
 * Use `titleText` / `text` (textContent) and build any rich content with DOM nodes + textContent.
 */
const classes = {
  container: "swal-container",
  popup: "swal-popup",
  title: "swal-title",
  htmlContainer: "swal-body",
  confirmButton: "btn primary",
  cancelButton: "btn secondary",
  denyButton: "btn danger",
};

const baseOptions = {
  buttonsStyling: false,
  customClass: classes,
} as const;

/*
 * Swal shows one popup at a time and a new fire() destroys the open one (resolving it as
 * dismissed). Modals are therefore serialised, and toasts raised while a modal is open or
 * queued are deferred until the modals are done.
 */
let activeModals = 0;
let modalChain: Promise<unknown> = Promise.resolve();
let pendingToast: (() => void) | null = null;

function modal<T>(fn: () => Promise<T>): Promise<T> {
  activeModals++;
  const run = modalChain.then(fn);
  modalChain = run
    .catch(() => undefined)
    .then(() => {
      activeModals--;
      if (activeModals === 0 && pendingToast) {
        const t = pendingToast;
        pendingToast = null;
        t();
      }
    });
  return run;
}

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  danger?: boolean;
}

/** Ask the user to confirm an action. Resolves true only on explicit confirmation. */
export function confirm({ title, text, confirmText = "Confirm", danger = false }: ConfirmOptions): Promise<boolean> {
  return modal(async () => {
  const result = await Swal.fire({
    ...baseOptions,
    customClass: { ...classes, confirmButton: danger ? "btn danger-solid" : "btn primary" },
    icon: "warning",
    titleText: title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancel",
    focusCancel: danger,
    reverseButtons: true,
  });
  return result.isConfirmed === true;
  });
}

const toaster = Swal.mixin({
  ...baseOptions,
  toast: true,
  position: "top-end",
  showConfirmButton: false,
  showCloseButton: true,
  timer: 4000,
  timerProgressBar: true,
  customClass: { ...classes, popup: "swal-popup swal-toast" },
});

function show(icon: "success" | "error" | "info", message: string) {
  const fire = () => void toaster.fire({ icon, titleText: message, timer: icon === "error" ? 8000 : 4000 });
  if (activeModals > 0) pendingToast = fire; // keep only the latest deferred toast
  else fire();
}

export const toast = {
  success: (message: string) => show("success", message),
  error: (message: string) => show("error", message),
  info: (message: string) => show("info", message),
};

/** Modal error dialog for failures the user must acknowledge. */
export function errorDialog(title: string, message: string): Promise<void> {
  return modal(async () => {
    await Swal.fire({ ...baseOptions, icon: "error", titleText: title, text: message, confirmButtonText: "Close" });
  });
}

/** Show per-group outcome of a summarize run. */
export function showSummaryResults(results: GroupActionResult[], message?: string | null): Promise<void> {
  return modal(async () => {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  const root = document.createElement("div");
  const head = document.createElement("p");
  head.textContent = results.length
    ? `${counts.sent} sent, ${counts.skipped} skipped, ${counts.failed} failed.`
    : message || "No groups were processed.";
  const list = document.createElement("ul");
  list.className = "swal-results";
  for (const r of results) {
    const li = document.createElement("li");
    li.className = `swal-result swal-result-${r.status}`;
    const badge = document.createElement("span");
    badge.className = `badge ${r.status === "sent" ? "ok" : r.status === "failed" ? "bad" : "warn"}`;
    badge.textContent = r.status;
    const name = document.createElement("strong");
    name.textContent = r.group_name;
    const detail = document.createElement("div");
    detail.className = "muted";
    detail.textContent = describeResult(r);
    li.append(badge, " ", name, detail);
    list.append(li);
  }
  root.append(head, list);
  await Swal.fire({
    ...baseOptions,
    icon: counts.failed ? "error" : counts.skipped || !results.length ? "warning" : "success",
    titleText: "Summary results",
    html: root,
    confirmButtonText: "Close",
  });
  });
}
