import { BellOff, Contact, LayoutDashboard, MessageSquare, Users, Zap, type LucideIcon } from "lucide-react";

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Primary items get their own phone tab; the rest live in the More sheet. */
  primary?: boolean;
  /** Match only the exact path (the Dashboard lives at "/"). */
  end?: boolean;
}

/** The single source of truth for navigation (sidebar, tab bar and More sheet). */
export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, primary: true, end: true },
  { to: "/groups", label: "Groups", icon: Users, primary: true },
  { to: "/messages", label: "Messages", icon: MessageSquare, primary: true },
  { to: "/actions", label: "Bot actions", icon: Zap, primary: true },
  { to: "/contacts", label: "Contacts", icon: Contact },
  { to: "/opt-outs", label: "Opt-outs", icon: BellOff },
];
