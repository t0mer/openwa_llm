import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "../../hooks/mockViewport";
import App from "../../App";

afterEach(() => vi.unstubAllGlobals());

function run(status: number, body: unknown) {
  mockViewport(1024);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
  render(<MemoryRouter initialEntries={["/groups"]}><App /></MemoryRouter>);
}

describe("state notices have landmarks", () => {
  it("loading", () => {
    run(200, { authenticated: true });
    expect(screen.getByRole("main")).toContainElement(screen.getByText("Loading…"));
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
  });

  it("disabled", async () => {
    run(404, {});
    const text = await screen.findByText(/disabled on this server/i);
    expect(screen.getByRole("main")).toContainElement(text);
    expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
    // announced the same way as on the Login page
    expect(text).toHaveAttribute("role", "status");
  });
});
