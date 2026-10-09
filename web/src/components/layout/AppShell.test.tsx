import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "../../hooks/mockViewport";
import { THEME_KEY } from "../../lib/theme";
import AppShell from "./AppShell";

const logout = vi.fn();
vi.mock("../../auth", () => ({ useAuth: () => ({ logout }) }));

function setup(width: number, path = "/groups") {
  mockViewport(width);
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="*" element={<p>page</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  logout.mockReset();
  localStorage.clear();
  document.documentElement.className = "";
});
afterEach(() => vi.unstubAllGlobals());

describe("AppShell breakpoints", () => {
  it.each([
    [767, "tabbar", false],
    [768, "sidebar", true],
    [1023, "sidebar", true],
    [1024, "sidebar", true],
  ])("at %ipx shows the %s", (width, _kind, sidebar) => {
    setup(width);
    expect(!!document.querySelector("aside")).toBe(sidebar);
    expect(!!document.querySelector("header")).toBe(!sidebar);
    expect(screen.getAllByRole("navigation", { name: "Main" })).toHaveLength(1);
  });

  it("is full width from 1024 and icon-only below, with labels on the links", () => {
    setup(1024);
    expect(document.querySelector("aside")).toHaveClass("w-60");
    expect(within(screen.getByRole("navigation")).getByText("Groups")).toBeVisible();
    document.body.innerHTML = "";
    setup(1023);
    expect(document.querySelector("aside")).toHaveClass("w-16");
    const link = screen.getByRole("link", { name: "Bot actions" });
    expect(link).toHaveAttribute("title", "Bot actions");
    expect(link.textContent).toBe("");
  });

  it("marks the active item with aria-current in both layouts", () => {
    setup(1024, "/contacts");
    expect(screen.getByRole("link", { name: "Contacts" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Groups" })).not.toHaveAttribute("aria-current");
  });

  it("phone tabs are Groups, Contacts, Messages, Bot actions and More (no Opt-outs tab)", () => {
    setup(375, "/messages");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Groups", "Contacts", "Messages", "Bot actions"]);
    expect(within(nav).getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(within(nav).getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  });

  it("keeps content clear of the fixed tab bar on phones", () => {
    setup(375);
    expect(screen.getByRole("main")).toHaveClass("pb-24", "md:pb-10");
  });
});

describe("skip link and landmarks", () => {
  it("has a skip link that focuses main", async () => {
    setup(1024);
    const skip = screen.getByRole("link", { name: "Skip to content" });
    expect(skip).toHaveAttribute("href", "#main");
    await userEvent.click(skip);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("is the first tab stop", async () => {
    setup(375);
    await userEvent.tab();
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveFocus();
  });

  it("shows the brand name", () => {
    setup(375);
    expect(screen.getByText("WhatsApp Bot Admin")).toBeInTheDocument();
  });
});

describe("More sheet", () => {
  it("opens with Opt-outs, Theme and Log out, and Escape closes it and returns focus", async () => {
    setup(375);
    const more = screen.getByRole("button", { name: "More" });
    await userEvent.click(more);
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getByRole("link", { name: "Opt-outs" })).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: "Log out" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(more).toHaveFocus();
  });

  it("closes on a backdrop click", async () => {
    setup(375);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(document.querySelector(".fixed.inset-0")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when a link is followed and marks More active on Opt-outs", async () => {
    setup(375, "/groups");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("link", { name: "Opt-outs" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("text-primary");
  });

  it("logs out", async () => {
    setup(375);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("button", { name: "Log out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("persists and applies the theme choice and shows the current one", async () => {
    setup(375);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("button", { name: "System" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    expect(screen.getByRole("button", { name: "Dark" })).toHaveAttribute("aria-pressed", "true");
    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement).not.toHaveClass("dark");
    await userEvent.click(screen.getByRole("button", { name: "System" }));
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});

describe("account menu", () => {
  it("offers System/Light/Dark with the current choice checked, and applies a pick", async () => {
    setup(1024);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    await userEvent.click(screen.getByRole("menuitemradio", { name: "Dark" }));
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    expect(document.documentElement).toHaveClass("dark");
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    expect(screen.getByRole("menuitemradio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
  });

  it("logs out", async () => {
    setup(768);
    await userEvent.click(screen.getByRole("button", { name: "Account menu" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Log out" }));
    expect(logout).toHaveBeenCalledTimes(1);
  });
});
