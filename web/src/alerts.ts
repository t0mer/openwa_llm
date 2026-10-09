import Swal from "sweetalert2";
import type { GroupActionResult } from "./types";

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
  returnFocus: true,
} as const;

export interface ConfirmOptions {
  title: string;
  text?: string;
  confirmText?: string;
  danger?: boolean;
}

/** Ask the user to confirm an action. Resolves true only on explicit confirmation. */
export async function confirm({ title, text, confirmText = "Confirm", danger = false }: ConfirmOptions): Promise<boolean> {
  const result = await Swal.fire({
    ...baseOptions,
    customClass: { ...classes, confirmButton: danger ? "btn danger-solid" : "btn primary" },
    icon: "warning",
    title,
    text,
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: "Cancel",
    focusCancel: danger,
    reverseButtons: true,
  });
  return result.isConfirmed === true;
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
  void toaster.fire({ icon, title: message, timer: icon === "error" ? 8000 : 4000 });
}

export const toast = {
  success: (message: string) => show("success", message),
  error: (message: string) => show("error", message),
  info: (message: string) => show("info", message),
};

/** Modal error dialog for failures the user must acknowledge. */
export async function errorDialog(title: string, message: string): Promise<void> {
  await Swal.fire({ ...baseOptions, icon: "error", title, text: message, confirmButtonText: "Close" });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Human readable explanation for one per-group result. */
export function describeResult(r: GroupActionResult): string {
  if (r.status === "sent") return "Summary sent";
  if (r.reason === "not_enough_messages" && r.message_count != null && r.required != null) {
    return `Skipped: ${r.message_count} of ${r.required} messages needed`;
  }
  const label = r.status === "failed" ? "Failed" : "Skipped";
  return r.reason ? `${label}: ${r.reason.replace(/_/g, " ")}` : label;
}

/** Show per-group outcome of a summarize run. */
export async function showSummaryResults(results: GroupActionResult[], message?: string | null): Promise<void> {
  const counts = { sent: 0, skipped: 0, failed: 0 };
  for (const r of results) counts[r.status]++;
  const rows = results
    .map(
      (r) =>
        `<li class="swal-result swal-result-${r.status}"><span class="badge ${r.status === "sent" ? "ok" : r.status === "failed" ? "bad" : "warn"}">${esc(r.status)}</span> <strong>${esc(r.group_name)}</strong><div class="muted">${esc(describeResult(r))}</div></li>`,
    )
    .join("");
  const head = results.length
    ? `<p>${counts.sent} sent, ${counts.skipped} skipped, ${counts.failed} failed.</p>`
    : `<p>${esc(message || "No groups were processed.")}</p>`;
  await Swal.fire({
    ...baseOptions,
    icon: counts.failed ? "error" : counts.skipped || !results.length ? "warning" : "success",
    title: "Summary results",
    html: `${head}<ul class="swal-results">${rows}</ul>`,
    confirmButtonText: "Close",
  });
}
