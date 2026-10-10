import { Brand } from "./Brand";

/** Sticky top bar on phones. */
export function PhoneHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
      <Brand />
    </header>
  );
}
