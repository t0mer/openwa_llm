import { Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import { Notice } from "./components/layout/Notice";
import AppShell from "./components/layout/AppShell";
import Actions from "./pages/Actions";
import Contacts from "./pages/Contacts";
import Dashboard from "./pages/Dashboard";
import Groups from "./pages/Groups";
import Login from "./pages/Login";
import Messages from "./pages/Messages";
import OptOuts from "./pages/OptOuts";
import Settings from "./pages/Settings";
import { SessionScoped } from "./session";

function Protected() {
  const { status } = useAuth();
  if (status === "loading") return <Notice live>Loading…</Notice>;
  if (status === "disabled") return <Notice live>The admin UI is disabled on this server.</Notice>;
  if (status !== "authenticated") return <Navigate to="/login" replace />;
  return <AppShell />;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected />}>
          {/* Session-scoped pages remount (and reload) when the selected session changes. */}
          <Route index element={<SessionScoped><Dashboard /></SessionScoped>} />
          <Route path="/groups" element={<SessionScoped><Groups /></SessionScoped>} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/opt-outs" element={<OptOuts />} />
          <Route path="/messages" element={<SessionScoped><Messages /></SessionScoped>} />
          <Route path="/actions" element={<Actions />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
