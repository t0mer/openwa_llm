import { Outlet } from "react-router-dom";
import { MD_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { MAIN_ID, SkipLink } from "./SkipLink";
import { Sidebar } from "./Sidebar";
import { PhoneHeader } from "./PhoneHeader";
import { TabBar } from "./TabBar";

/** Signed-in frame: sidebar from md, sticky header + bottom tab bar below. Pages render in <Outlet/>. */
export default function AppShell() {
  const desktop = useMediaQuery(MD_QUERY);
  return (
    <div className="min-h-dvh md:flex">
      <SkipLink />
      {desktop ? <Sidebar /> : <PhoneHeader />}
      <main
        id={MAIN_ID}
        tabIndex={-1}
        className="mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 pb-24 pt-5 focus:outline-none md:px-8 md:pb-10 md:pt-8"
      >
        <Outlet />
      </main>
      {!desktop && <TabBar />}
    </div>
  );
}
