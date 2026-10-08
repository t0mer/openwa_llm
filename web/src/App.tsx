import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth";
import Layout from "./components/Layout";
import Actions from "./pages/Actions";
import Contacts from "./pages/Contacts";
import Groups from "./pages/Groups";
import Login from "./pages/Login";
import Messages from "./pages/Messages";
import OptOuts from "./pages/OptOuts";

function Protected() {
  const { status } = useAuth();
  if (status === "loading") return <p className="notice">Loading…</p>;
  if (status === "disabled") return <p className="notice">The admin UI is disabled on this server.</p>;
  if (status !== "authenticated") return <Navigate to="/login" replace />;
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route element={<Protected />}>
          <Route index element={<Navigate to="/groups" replace />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/opt-outs" element={<OptOuts />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/actions" element={<Actions />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AuthProvider>
  );
}
