import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import html from "../../index.html?raw";
import { applyTheme, getThemeMode, resolveTheme, setThemeMode } from "./theme";

type Listener = () => void;
function mockMedia(initialDark: boolean) {
  let dark = initialDark;
  const listeners = new Set<Listener>();
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    get matches() {
      return query.includes("dark") ? dark : false;
    },
    media: query,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      dark = next;
      listeners.forEach((l) => l());
    },
    count: () => listeners.size,
  };
}

const root = () => document.documentElement;

describe("theme", () => {
  beforeEach(() => {
    localStorage.clear();
    root().classList.remove("dark");
  });
  afterEach(() => {
    applyTheme("light"); // drop any system listener
  });

  it("defaults to system and persists only an explicit light/dark under admin-theme", () => {
    mockMedia(false);
    expect(getThemeMode()).toBe("system");
    setThemeMode("dark");
    expect(localStorage.getItem("admin-theme")).toBe("dark");
    expect(getThemeMode()).toBe("dark");
    setThemeMode("system");
    expect(localStorage.getItem("admin-theme")).toBeNull();
    expect(getThemeMode()).toBe("system");
  });

  it("puts the dark class on <html> for dark, and for system when the OS is dark", () => {
    mockMedia(true);
    setThemeMode("light");
    expect(root().classList.contains("dark")).toBe(false);
    setThemeMode("dark");
    expect(root().classList.contains("dark")).toBe(true);
    setThemeMode("system");
    expect(root().classList.contains("dark")).toBe(true);
    expect(resolveTheme("system")).toBe("dark");
  });

  it("follows prefers-color-scheme changes only while in system mode", () => {
    const media = mockMedia(false);
    setThemeMode("system");
    expect(root().classList.contains("dark")).toBe(false);
    media.set(true);
    expect(root().classList.contains("dark")).toBe(true);
    media.set(false);
    expect(root().classList.contains("dark")).toBe(false);
    setThemeMode("light");
    expect(media.count()).toBe(0); // listener removed
    media.set(true);
    expect(root().classList.contains("dark")).toBe(false);
  });

  it("does not stack listeners when system is applied repeatedly", () => {
    const media = mockMedia(false);
    applyTheme("system");
    applyTheme("system");
    applyTheme("system");
    expect(media.count()).toBe(1);
  });

  it("applies the stored choice before render and survives blocked storage", () => {
    mockMedia(false);
    localStorage.setItem("admin-theme", "dark");
    applyTheme(); // what main.tsx calls before createRoot
    expect(root().classList.contains("dark")).toBe(true);
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(getThemeMode()).toBe("system");
    spy.mockRestore();
  });

  it("the inline head script sets the class before first paint, using the same key", () => {
    const script = /<script>([\s\S]*?)<\/script>/.exec(html)![1];
    expect(script).toContain('"admin-theme"');
    mockMedia(false);
    localStorage.setItem("admin-theme", "dark");
    new Function(script)();
    expect(root().classList.contains("dark")).toBe(true);
    localStorage.setItem("admin-theme", "light");
    mockMedia(true);
    new Function(script)();
    expect(root().classList.contains("dark")).toBe(false);
    localStorage.removeItem("admin-theme");
    new Function(script)();
    expect(root().classList.contains("dark")).toBe(true);
  });
});
