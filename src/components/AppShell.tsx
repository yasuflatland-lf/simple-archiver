import type { ReactNode } from "react";

import { PaneSeparator } from "@/components/PaneSeparator";
import { usePaneResize } from "@/hooks/usePaneResize";
import { cn } from "@/lib/utils";

interface AppShellProps {
  /** The fixed left rail: output settings + the Run/Cancel control. */
  rail: ReactNode;
  /** Optional alert banner shown across the top of the body. */
  banner?: ReactNode;
  /** The slim status footer. */
  statusBar: ReactNode;
  /** The right canvas: the morphing work area (the only vertical scroller). */
  children: ReactNode;
}

/**
 * The 2-pane app shell: a body row of a fixed left rail and a morphing right
 * canvas, with a slim status footer below. There is no header row (the app
 * header and theme toggle were removed; the theme follows the OS).
 *
 * Scroll discipline: the canvas (passed as `children`, a labelled `main`) is the
 * only region that scrolls vertically. The rail pane is shrink-0 and scrolls
 * only internally on a viewport too short to fit its natural height; the footer
 * is always pinned. The optional banner sits across the top of the body so a
 * surfaced error is visible above both panes.
 *
 * The rail pane is user-resizable: a {@link PaneSeparator} between the two panes
 * drives {@link usePaneResize}, which owns the rail width (drag, double-click
 * reset, and persistence). While dragging, the body suppresses text selection
 * and shows the col-resize cursor across both panes.
 */
export function AppShell({ rail, banner, statusBar, children }: AppShellProps) {
  const { railWidth, isDragging, separatorProps } = usePaneResize();
  return (
    <div
      data-testid="app-shell"
      className="flex h-screen flex-col bg-background text-foreground"
    >
      {banner ? (
        <div
          data-testid="app-banner"
          className="shrink-0 border-b border-border px-6 py-2"
        >
          {banner}
        </div>
      ) : null}
      <div
        data-testid="app-body"
        className={cn(
          "flex min-h-0 flex-1 flex-row overflow-hidden",
          isDragging && "cursor-col-resize select-none",
        )}
      >
        <div
          data-testid="rail-pane"
          className="flex min-h-0 shrink-0"
          style={{ width: `${railWidth}px` }}
        >
          {rail}
        </div>
        <PaneSeparator isDragging={isDragging} {...separatorProps} />
        {children}
      </div>
      <footer className="shrink-0 border-t border-border bg-muted/40 px-6 py-3">
        {statusBar}
      </footer>
    </div>
  );
}
