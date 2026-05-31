import type { ReactNode } from "react";

interface AppShellProps {
  /** Title + global affordances (e.g. theme toggle). */
  header: ReactNode;
  /** The setup zone: add sources, naming, output dir, Run/Cancel. */
  toolbar: ReactNode;
  /** Optional alert banner shown between the toolbar and the main region. */
  banner?: ReactNode;
  /** The footer zone: overall progress / results summary. */
  statusBar: ReactNode;
  /** The dominant content region (the queue, or an empty-state). */
  children: ReactNode;
}

/**
 * The production app-shell: a fixed header, a fixed setup toolbar, an optional
 * alert banner, a single scrollable main region, and a fixed status footer.
 * The vertical zones mirror the job lifecycle: everything above `main` is
 * mutable pre-run setup; the footer is post-run observation. Only `main`
 * scrolls (`flex-1 min-h-0 overflow-y-auto`) so Run/Cancel and overall progress
 * stay visible no matter how long the queue grows.
 */
export function AppShell({
  header,
  toolbar,
  banner,
  statusBar,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex shrink-0 items-center justify-between border-b border-border px-6 py-3">
        {header}
      </header>
      <div className="shrink-0 border-b border-border bg-muted/40 px-6 py-3">
        {toolbar}
      </div>
      {banner ? (
        <div data-testid="app-banner" className="shrink-0 px-6 pt-3">
          {banner}
        </div>
      ) : null}
      <main className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {children}
      </main>
      <footer className="shrink-0 border-t border-border bg-muted/40 px-6 py-3">
        {statusBar}
      </footer>
    </div>
  );
}
