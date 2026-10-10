import type { ReactNode } from "react";
import { APP_NAME } from "../ui/page-header";

/** A full-page status message (loading, disabled) that still has a main landmark and an h1. */
export function Notice({ children, live = false }: { children: ReactNode; live?: boolean }) {
  return (
    <main className="grid min-h-dvh place-items-center p-8">
      <h1 className="sr-only">{APP_NAME}</h1>
      <p className="text-center text-muted-foreground" role={live ? "status" : undefined}>
        {children}
      </p>
    </main>
  );
}
