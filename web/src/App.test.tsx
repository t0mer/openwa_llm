import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "./hooks/mockViewport";
import { api } from "./api";
import App from "./App";

/** A valid, empty /stats payload: the Dashboard renders at "/" and needs a well-formed response. */
const EMPTY_STATS = {
  from: "2026-10-03T00:00:00Z", to: "2026-10-10T00:00:00Z", timezone: "Asia/Jerusalem", bucket: "day",
  bot_excluded: true, groups: { total: 0, managed: 0 }, chats: 0, messages: 0, active_senders: 0,
  reactions: 0, kb_topics: 0, split: { text: 0, media: 0, other: 0 }, series: [], top_groups: [],
  top_senders: [], by_hour: Array(24).fill(0), by_weekday: Array(7).fill(0),
};

function stubSession(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/groups")
        ? new Response(JSON.stringify(status === 200 ? { items: [], total: 0 } : body), { status })
        : String(url).includes("/stats") && status === 200
          ? new Response(JSON.stringify(EMPTY_STATS), { status })
          : new Response(JSON.stringify(body), { status }),
    ),
  );
}

beforeEach(() => mockViewport(1024));
afterEach(() => vi.unstubAllGlobals());

describe("App auth routing", () => {
  it("redirects anonymous users to the login page", async () => {
    stubSession(200, { authenticated: false });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: /admin login/i })).toBeInTheDocument();
  });

  it("shows the disabled notice when the server returns 404", async () => {
    stubSession(404, { detail: "Not Found" });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    expect(await screen.findByText(/disabled on this server/i)).toBeInTheDocument();
  });

  it("renders the app shell for an authenticated session", async () => {
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole("link", { name: "Contacts" })).toBeInTheDocument());
  });

  it("shows the Dashboard at the root path", async () => {
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("sends unknown paths to the Dashboard", async () => {
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/nope"]}><App /></MemoryRouter>);
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("shows the shell on phones too and logs out from the More sheet", async () => {
    mockViewport(375);
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: /admin login/i })).toBeInTheDocument();
  });

  it("logs in and lands on the Dashboard", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/auth/login")
        ? new Response(null, { status: 204 })
        : String(url).includes("/groups")
          ? new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })
          : String(url).includes("/stats")
            ? new Response(JSON.stringify(EMPTY_STATS), { status: 200 })
            : new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
    await userEvent.type(await screen.findByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
  });

  it("returns to the login page when an API call gets a 401", async () => {
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    await screen.findByRole("link", { name: "Contacts" });
    stubSession(401, { detail: "not authenticated" });
    await act(async () => {
      await api.listOptOuts().catch(() => undefined);
    });
    expect(await screen.findByRole("heading", { name: /admin login/i })).toBeInTheDocument();
  });
});
