import { vi } from "vitest";

/** Manual mock so tests never render SweetAlert2 into jsdom. Use `vi.mock("../alerts")`. */
export const confirm = vi.fn(async (_opts: unknown) => true);
export const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
export const errorDialog = vi.fn(async (_title: string, _message: string) => {});
export const showSummaryResults = vi.fn(async (_results: unknown, _message?: unknown) => {});
export const describeResult = vi.fn((r: { status: string }) => r.status);
