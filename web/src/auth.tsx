import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ApiError, api, setUnauthorizedHandler } from "./api";

type Status = "loading" | "disabled" | "anonymous" | "authenticated";

interface AuthValue {
  status: Status;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    setUnauthorizedHandler(() => setStatus("anonymous"));
    api
      .session()
      .then((s) => setStatus(s.authenticated ? "authenticated" : "anonymous"))
      .catch((e) => setStatus(e instanceof ApiError && e.status === 404 ? "disabled" : "anonymous"));
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(async (password: string) => {
    await api.login(password);
    setStatus("authenticated");
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setStatus("anonymous");
    }
  }, []);

  const value = useMemo(() => ({ status, login, logout }), [status, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
