import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api";

export function useLoad<T>(load: () => Promise<T>, deps: unknown[], intervalMs = 60_000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async () => {
    try {
      setData(await loadRef.current());
      setError(null);
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 401)) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const depsKey = JSON.stringify(deps);
  useEffect(() => {
    setLoading(true);
    void reload();
    const id = setInterval(() => void reload(), intervalMs);
    return () => clearInterval(id);
  }, [reload, intervalMs, depsKey]);

  return { data, error, loading, reload };
}
