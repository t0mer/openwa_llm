import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";
import { toast } from "./alerts";

export function useLoad<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const id = ++seq.current;
    try {
      const result = await loadRef.current();
      if (id !== seq.current) return;
      setData(result);
      setError(null);
    } catch (e) {
      if (id !== seq.current) return;
      if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }
    setLoading(false);
  }, []);

  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    setLoading(true);
    void reload();
    const id = setInterval(() => void reload(), intervalMs);
    return () => {
      seq.current++;
      clearInterval(id);
    };
  }, [reload, intervalMs, depsKey]);

  return { data, error, loading, reload };
}

const TOAST_WINDOW_MS = 60_000;
const lastToasted = new Map<string, number>();

/** Surface a load error as a toast, at most once per message per minute (polls can flap). */
export function useErrorToast(error: string | null) {
  useEffect(() => {
    if (!error) return;
    const now = Date.now();
    const last = lastToasted.get(error);
    if (last !== undefined && now - last < TOAST_WINDOW_MS) return;
    lastToasted.set(error, now);
    toast.error(error);
  }, [error]);
}
