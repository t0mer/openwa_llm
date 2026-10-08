import { useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../auth";
import { applyTheme, getTheme, type Theme } from "../theme";

const LINKS: [string, string][] = [
  ["groups", "Groups"],
  ["contacts", "Contacts"],
  ["opt-outs", "Opt-outs"],
  ["messages", "Messages"],
  ["actions", "Bot actions"],
];

export default function Layout({ children }: { children: ReactNode }) {
  const { logout } = useAuth();
  const [theme, setTheme] = useState<Theme>(getTheme());

  function cycleTheme() {
    const next: Theme = theme === "system" ? "light" : theme === "light" ? "dark" : "system";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <div className="app">
      <header className="navbar">
        <strong className="brand">WhatsApp Bot Admin</strong>
        <nav>
          {LINKS.map(([to, label]) => (
            <NavLink key={to} to={`/${to}`} className={({ isActive }) => (isActive ? "active" : "")}>
              {label}
            </NavLink>
          ))}
        </nav>
        <span className="spacer" />
        <button type="button" onClick={cycleTheme}>
          Theme: {theme}
        </button>
        <button type="button" onClick={() => void logout()}>
          Log out
        </button>
      </header>
      <main className="content">{children}</main>
    </div>
  );
}
