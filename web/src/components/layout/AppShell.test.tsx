import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockViewport } from "../../hooks/mockViewport";
import { THEME_KEY } from "../../lib/theme";
import AppShell from "./AppShell";

const logout = vi.fn();
vi.mock("../../auth", () => ({ useAuth: () => ({ logout }) }));

let viewport: ReturnType<typeof mockViewport>;
function setup(width: number, path = "/groups") {
  viewport = mockViewport(width);
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
    const first = setup(1024);
    expect(document.querySelector("aside")).toHaveClass("w-60");
    expect(within(screen.getByRole("navigation")).getByText("Groups")).toBeVisible();
    first.unmount();
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

  it("marks Dashboard active only on the exact root path", () => {
    const first = setup(1024, "/");
    expect(screen.getByRole("link", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");
    first.unmount();
    setup(1024, "/groups");
    expect(screen.getByRole("link", { name: "Dashboard" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Groups" })).toHaveAttribute("aria-current", "page");
  });

  it("lists the sidebar links in order", () => {
    setup(1024);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Dashboard", "Groups", "Messages", "Bot actions", "Contacts", "Opt-outs",
    ]);
  });

  it("phone tabs are Dashboard, Groups, Messages, Bot actions and More (Contacts and Opt-outs inside More)", async () => {
    setup(375, "/messages");
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual(["Dashboard", "Groups", "Messages", "Bot actions"]);
    expect(within(nav).getByRole("button", { name: "More" })).toBeInTheDocument();
    await userEvent.click(within(nav).getByRole("button", { name: "More" }));
    const sheet = screen.getByRole("dialog", { name: "More" });
    expect(within(sheet).getByRole("link", { name: "Contacts" })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Opt-outs" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    expect(within(nav).getByRole("link", { name: "Messages" })).toHaveAttribute("aria-current", "page");
  });

  it("highlights More on the Contacts page", () => {
    setup(375, "/contacts");
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("text-primary");
  });

  it("keeps content clear of the fixed tab bar on phones", () => {
    setup(375);
    expect(screen.getByRole("main")).toHaveClass("pb-24", "md:pb-10");
  });
});

describe("resizing", () => {
  it("swaps sidebar wide, icon-only and tab bar as the viewport changes", () => {
    setup(1024);
    expect(document.querySelector("aside")).toHaveClass("w-60");
    viewport.setWidth(800);
    expect(document.querySelector("aside")).toHaveClass("w-16");
    viewport.setWidth(600);
    expect(document.querySelector("aside")).toBeNull();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    viewport.setWidth(1024);
    expect(document.querySelector("aside")).toHaveClass("w-60");
    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
  });

  it("closes an open More sheet when the viewport becomes desktop", async () => {
    setup(600);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    expect(screen.getByRole("dialog", { name: "More" })).toBeInTheDocument();
    viewport.setWidth(1024);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("removes its media query listeners on unmount", () => {
    const { unmount } = setup(1024);
    expect(viewport.listenerCount()).toBeGreaterThan(0);
    unmount();
    expect(viewport.listenerCount()).toBe(0);
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
    await userEvent.click(document.querySelector("[data-dialog-overlay]")!);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes when a link is followed and marks More active on Opt-outs", async () => {
    setup(375, "/groups");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("link", { name: "Opt-outs" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("text-primary");
  });

  it("ignores Escape while a SweetAlert popup is open, but not for a toast", async () => {
    setup(375);
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    const pop = document.createElement("div");
    pop.className = "swal2-popup";
    document.body.append(pop);
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog", { name: "More" })).toBeInTheDocument();
    pop.className = "swal2-popup swal2-toast";
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    pop.remove();
  });

  it("closes when the link for the current page is tapped", async () => {
    setup(375, "/opt-outs");
    await userEvent.click(screen.getByRole("button", { name: "More" }));
    await userEvent.click(screen.getByRole("link", { name: "Opt-outs" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it.each(["/Opt-Outs", "/opt-outs/", "/opt-outs/x"])("highlights More for %s", (path) => {
    setup(375, path);
    expect(screen.getByRole("button", { name: "More" })).toHaveClass("text-primary");
  });

  it("does not highlight More on a primary page or a lookalike path", () => {
    setup(375, "/opt-outsider");
    expect(screen.getByRole("button", { name: "More" })).not.toHaveClass("text-primary");
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
