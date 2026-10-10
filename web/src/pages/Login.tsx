import { Loader2, MessagesSquare } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Notice } from "../components/layout/Notice";
import { Button } from "../components/ui/button";
import { Field, Input } from "../components/ui/field";
import { InlineError } from "../components/ui/inline-error";
import { APP_NAME } from "../components/ui/page-header";

export default function Login() {
  const { status, login } = useAuth();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.title = `Log in · ${APP_NAME}`;
  }, []);

  if (status === "authenticated") return <Navigate to="/" replace />;
  if (status === "disabled") return <Notice live>The admin UI is disabled on this server.</Notice>;

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
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <form onSubmit={submit} className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-border bg-surface p-6 shadow-overlay">
        <div className="flex flex-col items-center gap-2 text-center">
          <MessagesSquare aria-hidden="true" className="size-8 text-primary" />
          <p className="text-sm text-muted-foreground">{APP_NAME}</p>
          <h1 className="text-2xl font-semibold tracking-tight">Admin login</h1>
        </div>
        <Field label="Password">
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus required autoComplete="current-password" />
        </Field>
        <Button type="submit" variant="primary" size="lg" disabled={busy} aria-busy={busy}>
          {busy && <Loader2 data-testid="login-spinner" aria-hidden="true" className="animate-spin" />}
          Log in
        </Button>
        {error && <InlineError>{error}</InlineError>}
      </form>
    </main>
  );
}
