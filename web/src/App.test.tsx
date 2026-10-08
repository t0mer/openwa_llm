import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import App from "./App";

function stubSession(status: number, body: unknown = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })),
  );
}

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
});
