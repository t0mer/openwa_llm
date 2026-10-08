import { useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";

export default function Login() {
  const { status, login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === "authenticated") return <Navigate to="/groups" replace />;
  if (status === "disabled") return <p className="notice">The admin UI is disabled on this server.</p>;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(password);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 429
          ? "Too many attempts. Try again in a minute."
          : err instanceof ApiError && err.status === 401
            ? "Wrong password."
            : "Login failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login" onSubmit={submit}>
      <h1>Admin login</h1>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required />
      </label>
      <button type="submit" disabled={busy}>Log in</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
