import type { GroupActionResult } from "./types";

/** Human readable explanation for one per-group result. */
export function describeResult(r: GroupActionResult): string {
  if (r.status === "sent") return "Summary sent";
  if (r.reason === "not_enough_messages" && r.message_count != null && r.required != null) {
    return `Skipped: ${r.message_count} of ${r.required} messages needed`;
  }
  const label = r.status === "failed" ? "Failed" : "Skipped";
  return r.reason ? `${label}: ${r.reason.replace(/_/g, " ")}` : label;
}
