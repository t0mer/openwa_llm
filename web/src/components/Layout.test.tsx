import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, Link } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import Layout from "./Layout";

vi.mock("../auth", () => ({ useAuth: () => ({ logout: vi.fn() }) }));

function setup() {
  return render(
    <MemoryRouter initialEntries={["/groups"]}>
      <Layout>
        <Routes>
          <Route path="*" element={<p>page</p>} />
        </Routes>
        <Link to="/contacts">elsewhere</Link>
      </Layout>
    </MemoryRouter>,
  );
}

describe("Layout", () => {
  it("has a skip link, a labelled nav and a main landmark", () => {
    setup();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveAttribute("href", "#main");
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main");
  });

  it("toggles the mobile menu with aria-expanded and aria-controls", async () => {
    setup();
    const btn = screen.getByRole("button", { name: "Menu" });
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveAttribute("aria-controls", nav.id);
    expect(nav).not.toHaveClass("open");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "true");
    expect(nav).toHaveClass("open");
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("closes the menu on Escape and returns focus to the button", async () => {
    setup();
    const btn = screen.getByRole("button", { name: "Menu" });
    await userEvent.click(btn);
    await userEvent.keyboard("{Escape}");
    expect(btn).toHaveAttribute("aria-expanded", "false");
    expect(btn).toHaveFocus();
  });

  it("closes the menu when a nav link is followed", async () => {
    setup();
    const btn = screen.getByRole("button", { name: "Menu" });
    await userEvent.click(btn);
    await userEvent.click(screen.getByRole("link", { name: "Contacts" }));
    expect(btn).toHaveAttribute("aria-expanded", "false");
  });

  it("still cycles the theme", async () => {
    setup();
    await userEvent.click(screen.getByRole("button", { name: /theme: system/i }));
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
  });
});
