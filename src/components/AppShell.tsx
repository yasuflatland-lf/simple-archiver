import type { ReactNode } from "react";

interface AppShellProps {
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
 * The production app-shell: a content-sized setup toolbar, an optional alert
 * banner, a scrollable queue region (`main`), and a fixed status footer. The
 * vertical zones mirror the job lifecycle: everything above `main` is mutable
 * pre-run setup; the footer is post-run observation.
 *
 * Vertical shrink is absorbed by the queue: `main` is the only zone that scrolls
 * (`flex-1 min-h-0 overflow-y-auto`), so the full setup zone (OUTPUT settings +
 * Run/Cancel) and the footer all stay visible no matter how long the queue grows
 * or how short the window gets.
 *
 * Last-resort scroll: setup, banner and `main` share a scroll wrapper
 * (`flex-1 min-h-0 overflow-y-auto`). On a viewport too short to fit even the
 * setup zone at its natural height, `main` collapses to zero and the wrapper
 * scrolls instead — so the setup content is never clipped and stays reachable.
 * The footer sits outside the wrapper and is always visible.
 */
export function AppShell({
  toolbar,
  banner,
  statusBar,
  children,
}: AppShellProps) {
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Last-resort scroll wrapper: everything except the pinned footer. In the
          normal case its content fits, so it does not scroll and only `main`
          (the queue) does; on an extremely short viewport it scrolls to keep the
          setup zone reachable rather than clipping it. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-background text-foreground">
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
      </div>
      <footer className="shrink-0 border-t border-border bg-muted/40 px-6 py-3">
        {statusBar}
      </footer>
    </div>
  );
}
