import { useCallback, useEffect, useRef, useState } from "react";

/**
 * An `onCloseAutoFocus` handler for a Radix dialog that has no Trigger (Radix would then drop focus
 * on <body>). After the dialog unmounts it calls `returnFocus`, or focuses the element that had
 * focus when the dialog opened if that is still in the document. StrictMode's simulated unmount
 * (the dialog is still open) is ignored.
 */
export function useReturnFocus(returnFocus?: () => void) {
  const [opener] = useState(() => (typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)));
  const live = useRef(true);
  const callback = useRef(returnFocus);
  useEffect(() => {
    callback.current = returnFocus;
  });
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  return useCallback(
    (e: Event) => {
      e.preventDefault();
      if (live.current) return;
      if (callback.current) callback.current();
      else if (opener?.isConnected) opener.focus();
    },
    [opener],
  );
}
