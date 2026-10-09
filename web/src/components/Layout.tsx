import { useEffect, useRef, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../auth";
import { getThemeMode, setThemeMode, type ThemeMode } from "../lib/theme";

const LINKS: [string, string][] = [
  ["groups", "Groups"],
  ["contacts", "Contacts"],
  ["opt-outs", "Opt-outs"],
  ["messages", "Messages"],
  ["actions", "Bot actions"],
];

const NAV_ID = "main-nav";

function Burger({ open }: { open: boolean }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {open ? (
        <path d="M4 4l12 12M16 4L4 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      ) : (
        <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      )}
    </svg>
  );
}

export default function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [theme, setTheme] = useState<ThemeMode>(getThemeMode());
  const [open, setOpen] = useState(false);
  const burger = useRef<HTMLButtonElement>(null);
  const header = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !document.querySelector(".swal2-popup:not(.swal2-toast)")) {
        setOpen(false);
        burger.current?.focus();
      }
    }
    function onDown(e: MouseEvent | TouchEvent) {
      if (header.current && !header.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
    };
  }, [open]);

  function cycleTheme() {
    const next: ThemeMode = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    setThemeMode(next);
    setTheme(next);
  }

  return (
    <div className="app">
      <a className="skip-link" href="#main">Skip to content</a>
      <header ref={header} className="navbar">
        <div className="navbar-inner">
          <strong className="brand">WhatsApp Bot Admin</strong>
          <button
            ref={burger}
            type="button"
            className="btn ghost icon-btn burger"
            aria-label="Menu"
            aria-expanded={open}
            aria-controls={NAV_ID}
            onClick={() => setOpen((o) => !o)}
          >
            <Burger open={open} />
          </button>
          <nav id={NAV_ID} aria-label="Main" className={open ? "open" : ""}>
            {LINKS.map(([to, label]) => (
              <NavLink key={to} to={`/${to}`} className={({ isActive }) => (isActive ? "active" : "")}>
                {label}
              </NavLink>
            ))}
            <span className="nav-actions">
              <button type="button" className="btn ghost" onClick={cycleTheme}>
                Theme: {theme}
              </button>
              <button type="button" className="btn ghost" onClick={() => void logout()}>
                Log out
              </button>
            </span>
          </nav>
        </div>
      </header>
      <main id="main" className="content" tabIndex={-1}>{children}</main>
    </div>
  );
}
