interface DropOverlayProps {
  /** Whether a drag is currently over the window. */
  visible: boolean;
}

/**
 * A full-window overlay shown while the user drags files/folders over the app.
 * Purely presentational and non-interactive (`pointer-events-none`) so it never
 * intercepts the OS drop; the drop itself is handled by `useFileDrop` at the
 * app root.
 */
export function DropOverlay({ visible }: DropOverlayProps) {
  if (!visible) return null;
  return (
    <div
      data-testid="drop-overlay"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10 text-primary"
    >
      <p className="text-lg font-semibold">Drop to add</p>
    </div>
  );
}
