import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../api";
import { SessionScoped, getSessionId, notifySessionsChanged, setSessionId } from "../../session";
import type { SessionInfo } from "../../types";
import { SessionSwitcher } from "./SessionSwitcher";

vi.mock("../../api", async (orig) => {
  const actual = await orig<typeof import("../../api")>();
  return { ...actual, api: { listSessions: vi.fn() } };
});

const s = (id: string, label: string, enabled = true, error: string | null = null): SessionInfo => ({
  id, label, openwa_session_id: `wa-${id}`, enabled, status: null, error, group_count: 0,
});

function setup() {
  return render(<MemoryRouter><SessionSwitcher /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  setSessionId(null);
});

describe("SessionSwitcher", () => {
  it("links to Settings when no session exists and clears the selection", async () => {
    setSessionId("gone");
    vi.mocked(api.listSessions).mockResolvedValue([]);
    setup();
    const link = await screen.findByRole("link", { name: "No sessions configured" });
    expect(link).toHaveAttribute("href", "/settings");
    await waitFor(() => expect(getSessionId()).toBeNull());
  });

  it("shows a plain label for a single session and selects it", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s("s1", "Main")]);
    setup();
    expect(await screen.findByText("Main")).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    await waitFor(() => expect(getSessionId()).toBe("s1"));
  });

  it("defaults to the first enabled working session when the stored one is not valid", async () => {
    setSessionId("gone");
    vi.mocked(api.listSessions).mockResolvedValue([s("s1", "Off", false), s("s2", "Broken", true, "bad"), s("s3", "Good")]);
    setup();
    const select = await screen.findByRole("combobox", { name: "Session" });
    await waitFor(() => expect(getSessionId()).toBe("s3"));
    expect(select).toHaveValue("s3");
    expect(screen.getByRole("option", { name: "Off" })).toBeDisabled();
  });

  it("keeps a valid stored selection and switches on change", async () => {
    setSessionId("s2");
    vi.mocked(api.listSessions).mockResolvedValue([s("s1", "One"), s("s2", "Two")]);
    setup();
    const select = await screen.findByRole("combobox", { name: "Session" });
    expect(select).toHaveValue("s2");
    await userEvent.selectOptions(select, "s1");
    expect(getSessionId()).toBe("s1");
  });

  it("reloads the list when sessions change", async () => {
    vi.mocked(api.listSessions).mockResolvedValue([s("s1", "One")]);
    setup();
    await screen.findByText("One");
    vi.mocked(api.listSessions).mockResolvedValue([s("s1", "One"), s("s2", "Two")]);
    act(() => notifySessionsChanged());
    expect(await screen.findByRole("combobox", { name: "Session" })).toBeInTheDocument();
  });

  it("renders nothing while the list fails to load", async () => {
    vi.mocked(api.listSessions).mockRejectedValue(new Error("down"));
    const { container } = setup();
    await waitFor(() => expect(api.listSessions).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe("SessionScoped", () => {
  it("remounts its page when the selected session changes", () => {
    let mounts = 0;
    function Page() {
      useEffect(() => {
        mounts++;
      }, []);
      return <p>page</p>;
    }
    render(<SessionScoped><Page /></SessionScoped>);
    expect(mounts).toBe(1);
    act(() => setSessionId("s1"));
    expect(mounts).toBe(2);
    act(() => setSessionId("s1"));
    expect(mounts).toBe(2);
  });
});
