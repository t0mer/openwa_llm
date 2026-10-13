import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Settings from "./Settings";
import { mockViewport } from "../hooks/mockViewport";
import { ApiError, api } from "../api";
import type { ConnectionSettings, SessionInfo } from "../types";

vi.mock("../api", async (orig) => {
  const actual = await orig<typeof import("../api")>();
  return {
    ...actual,
    api: {
      getConnection: vi.fn(),
      putConnection: vi.fn(),
      testConnection: vi.fn(),
      listSessions: vi.fn(),
      createSession: vi.fn(),
      patchSession: vi.fn(),
      deleteSession: vi.fn(),
      registerWebhook: vi.fn(),
    },
  };
});

vi.mock("../alerts");
import { confirm, toast } from "../alerts";

const CONNECTION: ConnectionSettings = {
  base_url: "http://openwa:2785",
  webhook_url: "http://bot:8000/webhook",
  api_key_set: true,
  webhook_secret_set: false,
};

const SESSIONS: SessionInfo[] = [
  { id: "s1", label: "Main", openwa_session_id: "wa-main", enabled: true, status: "WORKING", error: null, group_count: 3 },
  { id: "s2", label: "Backup", openwa_session_id: "wa-backup", enabled: false, status: null, error: "gateway unreachable", group_count: 0 },
];

beforeEach(() => {
  vi.clearAllMocks();
  mockViewport(1024);
  vi.mocked(api.getConnection).mockResolvedValue(CONNECTION);
  vi.mocked(api.putConnection).mockResolvedValue({ ...CONNECTION, webhook_secret_set: true });
  vi.mocked(api.testConnection).mockResolvedValue({ ok: true, detail: "session status: WORKING" });
  vi.mocked(api.listSessions).mockResolvedValue(SESSIONS);
  vi.mocked(api.createSession).mockResolvedValue({ ...SESSIONS[0], id: "s3", label: "New", openwa_session_id: "wa-new" });
  vi.mocked(api.patchSession).mockResolvedValue(SESSIONS[0]);
  vi.mocked(api.deleteSession).mockResolvedValue(undefined);
  vi.mocked(api.registerWebhook).mockResolvedValue({ registered: true });
  vi.mocked(confirm).mockResolvedValue(true);
});

describe("Settings page: connection", () => {
  it("renders the connection with empty secret inputs and a stored hint", async () => {
    render(<Settings />);
    expect(await screen.findByLabelText("OpenWA base URL")).toHaveValue("http://openwa:2785");
    expect(screen.getByLabelText("Webhook URL")).toHaveValue("http://bot:8000/webhook");
    const key = screen.getByLabelText("API key");
    expect(key).toHaveValue("");
    expect(key).toHaveAttribute("type", "password");
    expect(key).toHaveAttribute("autocomplete", "new-password");
    expect(key).toHaveAttribute("placeholder", "•••• stored");
    const secret = screen.getByLabelText("Webhook secret");
    expect(secret).toHaveValue("");
    expect(secret).toHaveAttribute("type", "password");
    expect(secret).not.toHaveAttribute("placeholder", "•••• stored");
  });

  it("sends null for a secret left blank and trims the rest", async () => {
    render(<Settings />);
    const base = await screen.findByLabelText("OpenWA base URL");
    await userEvent.clear(base);
    await userEvent.type(base, "  http://new:1  ");
    await userEvent.type(screen.getByLabelText("Webhook secret"), "  abcdefghijklmnopqr  ");
    await userEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() =>
      expect(api.putConnection).toHaveBeenCalledWith({
        base_url: "http://new:1",
        webhook_url: "http://bot:8000/webhook",
        api_key: null,
        webhook_secret: "abcdefghijklmnopqr",
      }),
    );
    expect(toast.success).toHaveBeenCalled();
    expect(screen.getByLabelText("Webhook secret")).toHaveValue("");
  });

  it("shows a save failure as a toast", async () => {
    vi.mocked(api.putConnection).mockRejectedValueOnce(new ApiError(422, "api_key and webhook_secret are required"));
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("api_key and webhook_secret are required"));
  });

  it("tests the unsaved values and shows the returned detail", async () => {
    render(<Settings />);
    const base = await screen.findByLabelText("OpenWA base URL");
    await userEvent.clear(base);
    await userEvent.type(base, " http://try:2 ");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(api.testConnection).toHaveBeenCalledWith({ base_url: "http://try:2", api_key: null }));
    expect(await screen.findByText("session status: WORKING")).toBeInTheDocument();
    expect(api.putConnection).not.toHaveBeenCalled();
  });

  it("marks a failed test as failed", async () => {
    vi.mocked(api.testConnection).mockResolvedValueOnce({ ok: false, detail: "connection refused" });
    render(<Settings />);
    await userEvent.type(await screen.findByLabelText("API key"), " k3y ");
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));
    await waitFor(() => expect(api.testConnection).toHaveBeenCalledWith({ base_url: "http://openwa:2785", api_key: "k3y" }));
    const result = await screen.findByRole("status", { name: "Connection test" });
    expect(result).toHaveTextContent("Failed");
    expect(result).toHaveTextContent("connection refused");
  });

  it("never renders a secret value it was given", async () => {
    render(<Settings />);
    await userEvent.type(await screen.findByLabelText("API key"), "supersecret");
    await userEvent.click(screen.getByRole("button", { name: "Save connection" }));
    await waitFor(() => expect(api.putConnection).toHaveBeenCalled());
    expect(document.body.textContent).not.toContain("supersecret");
  });
});

describe("Settings page: sessions", () => {
  it("lists sessions with status and error", async () => {
    render(<Settings />);
    const list = await screen.findByRole("list", { name: "Sessions" });
    expect(within(list).getByText("Main")).toBeInTheDocument();
    expect(within(list).getByText("wa-main")).toBeInTheDocument();
    expect(within(list).getByText("WORKING")).toBeInTheDocument();
    expect(within(list).getByText("gateway unreachable")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Enable Main" })).toBeChecked();
    expect(screen.getByRole("switch", { name: "Enable Backup" })).not.toBeChecked();
  });

  it("adds a session with trimmed values", async () => {
    render(<Settings />);
    const form = await screen.findByRole("form", { name: "Add session" });
    await userEvent.type(within(form).getByLabelText("Label"), "  New ");
    await userEvent.type(within(form).getByLabelText("OpenWA session id"), " wa-new ");
    await userEvent.click(within(form).getByRole("button", { name: "Add session" }));
    await waitFor(() => expect(api.createSession).toHaveBeenCalledWith({ label: "New", openwa_session_id: "wa-new" }));
    expect(within(form).getByLabelText("Label")).toHaveValue("");
  });

  it("toggles a session", async () => {
    render(<Settings />);
    await userEvent.click(await screen.findByRole("switch", { name: "Enable Backup" }));
    await waitFor(() => expect(api.patchSession).toHaveBeenCalledWith("s2", { enabled: true }));
  });

  it("edits a session's label and id", async () => {
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: "Edit Main" }));
    const form = screen.getByRole("form", { name: "Edit Main" });
    const label = within(form).getByLabelText("Label");
    await userEvent.clear(label);
    await userEvent.type(label, " Primary ");
    await userEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.patchSession).toHaveBeenCalledWith("s1", { label: "Primary", openwa_session_id: "wa-main" }));
  });

  it("re-registers the webhook", async () => {
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: "Re-register webhook for Main" }));
    await waitFor(() => expect(api.registerWebhook).toHaveBeenCalledWith("s1"));
    expect(toast.success).toHaveBeenCalled();
  });

  it("deletes after a confirmation and surfaces a 409 as a toast", async () => {
    vi.mocked(api.deleteSession).mockRejectedValueOnce(new ApiError(409, "session still owns groups; disable it instead"));
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Main" }));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true, text: expect.stringContaining("Main") }));
    await waitFor(() => expect(api.deleteSession).toHaveBeenCalledWith("s1"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("session still owns groups; disable it instead"));
  });

  it("does not delete when the confirmation is declined", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    render(<Settings />);
    await userEvent.click(await screen.findByRole("button", { name: "Delete Main" }));
    expect(api.deleteSession).not.toHaveBeenCalled();
  });

  it("shows a load failure inline", async () => {
    vi.mocked(api.listSessions).mockRejectedValue(new ApiError(500, "boom"));
    render(<Settings />);
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("shows an empty state with no sessions", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([]);
    render(<Settings />);
    expect(await screen.findByText("No sessions yet.")).toBeInTheDocument();
  });
});
