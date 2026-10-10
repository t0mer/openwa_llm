import userEvent from "@testing-library/user-event";
import { act, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "./hooks/mockViewport";
import { api } from "./api";
import App from "./App";

function stubSession(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) =>
      String(url).includes("/groups")
        ? new Response(JSON.stringify(status === 200 ? { items: [], total: 0 } : body), { status })
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

  it("shows the shell on phones too and logs out from the More sheet", async () => {
    mockViewport(375);
    stubSession(200, { authenticated: true });
    render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
    await userEvent.click(await screen.findByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(await screen.findByRole("heading", { name: /admin login/i })).toBeInTheDocument();
  });

  it("logs in and lands on the groups page", async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/auth/login")
        ? new Response(null, { status: 204 })
        : String(url).includes("/groups")
          ? new Response(JSON.stringify({ items: [], total: 0 }), { status: 200 })
          : new Response(JSON.stringify({ authenticated: false }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<MemoryRouter initialEntries={["/login"]}><App /></MemoryRouter>);
    await userEvent.type(await screen.findByLabelText(/password/i), "pw");
    await userEvent.click(screen.getByRole("button", { name: /log in/i }));
    expect(await screen.findByRole("heading", { name: "Groups" })).toBeInTheDocument();
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
