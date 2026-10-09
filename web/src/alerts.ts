import Swal, { type SweetAlertOptions, type SweetAlertResult } from "sweetalert2";
import { describeResult } from "./results";
import { buttonVariants } from "./components/ui/button-variants";
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
  // The same classes the Button component uses, so popups match the rest of the UI in both themes.
  confirmButton: buttonVariants({ variant: "primary" }),
  cancelButton: buttonVariants({ variant: "outline" }),
  denyButton: buttonVariants({ variant: "danger" }),
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
const MAX_DEFERRED = 3;
const pendingToasts: { icon: "success" | "error" | "info"; message: string }[] = [];

/** Resolves once every queued modal has fully closed (exposed for tests). */
export async function modalsIdle(close: () => void): Promise<void> {
  while (activeModals > 0) {
    close();
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Messages of toasts currently deferred behind a modal (exposed for tests). */
export const deferredToasts = () => pendingToasts.map((t) => t.message);

function deferToast(icon: "success" | "error" | "info", message: string) {
  pendingToasts.push({ icon, message });
  if (pendingToasts.length > MAX_DEFERRED) pendingToasts.shift(); // drop the oldest
}

function modal<T>(fn: () => Promise<T>): Promise<T> {
  activeModals++;
  const run = modalChain.then(fn);
  modalChain = run
    .catch(() => undefined)
    .then(() => {
      activeModals--;
      if (activeModals === 0) {
        // Show the deferred toasts one after another; each toast replaces the previous one.
        const queued = pendingToasts.splice(0);
        queued.forEach((t, i) =>
          setTimeout(() => (activeModals > 0 ? deferToast(t.icon, t.message) : fireToast(t.icon, t.message)), i * 1500),
        );
      }
    });
  return run;
}

/**
 * Fire a modal and settle only once SweetAlert has fully torn it down. `Swal.fire` resolves when
 * the hide animation STARTS; SweetAlert restores the aria-hidden it recorded on the <body>
 * children only when the animation ends. A caller that closes a Radix dialog in between (whose
 * aria-hidden SweetAlert recorded) would get the whole app hidden again. `didDestroy` runs after
 * that restore, and also when a popup is replaced or closed programmatically.
 */
function fireModal(options: SweetAlertOptions): Promise<SweetAlertResult> {
  return new Promise((resolve) => {
    let result: SweetAlertResult = { isConfirmed: false, isDenied: false, isDismissed: true };
    void Swal.fire({ ...options, didDestroy: () => resolve(result) }).then((r) => {
      result = r;
    });
  });
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
  const result = await fireModal({
    ...baseOptions,
    customClass: { ...classes, confirmButton: buttonVariants({ variant: danger ? "danger" : "primary" }) },
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

function fireToast(icon: "success" | "error" | "info", message: string) {
  void toaster.fire({ icon, titleText: message, timer: icon === "error" ? 8000 : 4000 });
}

function show(icon: "success" | "error" | "info", message: string) {
  if (activeModals > 0) deferToast(icon, message);
  else fireToast(icon, message);
}

export const toast = {
  success: (message: string) => show("success", message),
  error: (message: string) => show("error", message),
  info: (message: string) => show("info", message),
};

/** Modal error dialog for failures the user must acknowledge. */
export function errorDialog(title: string, message: string): Promise<void> {
  return modal(async () => {
    await fireModal({ ...baseOptions, icon: "error", titleText: title, text: message, confirmButtonText: "Close" });
  });
}

/** Icon for a results dialog: success if all sent, error if all failed, info if all skipped, else warning. */
export function summaryIcon(counts: { sent: number; skipped: number; failed: number }, total: number): "success" | "error" | "info" | "warning" {
  if (total === 0) return "warning";
  if (counts.sent === total) return "success";
  if (counts.failed === total) return "error";
  if (counts.skipped === total) return "info";
  return "warning";
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
    badge.className = `swal-result-badge swal-result-badge-${r.status}`;
    badge.textContent = r.status;
    const name = document.createElement("strong");
    name.textContent = r.group_name;
    const detail = document.createElement("div");
    detail.className = "swal-result-detail";
    detail.textContent = describeResult(r);
    li.append(badge, " ", name, detail);
    list.append(li);
  }
  root.append(head, list);
  await fireModal({
    ...baseOptions,
    icon: summaryIcon(counts, results.length),
    titleText: "Summary results",
    html: root,
    confirmButtonText: "Close",
  });
  });
}
