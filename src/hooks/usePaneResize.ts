import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  clampRailWidth,
  DEFAULT_RAIL_WIDTH,
  loadPersistedRailWidth,
  persistRailWidth,
  railWidthMaxFor,
} from "@/lib/rail-width";

/** ARIA + pointer handlers a separator element spreads to become draggable. */
export interface PaneSeparatorProps {
  role: "separator";
  "aria-orientation": "vertical";
  "aria-label": string;
  onPointerDown: (event: ReactPointerEvent) => void;
  onPointerMove: (event: ReactPointerEvent) => void;
  onPointerUp: (event: ReactPointerEvent) => void;
  onPointerCancel: (event: ReactPointerEvent) => void;
  onLostPointerCapture: (event: ReactPointerEvent) => void;
  onDoubleClick: () => void;
}

export interface PaneResize {
  /** The current left-rail width in px, clamped to the canvas-preserving range. */
  railWidth: number;
  /** True while a resize drag is in progress. */
  isDragging: boolean;
  /** Ref to attach to the two-pane body; its width bounds how far the rail grows. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Props to spread onto the separator element between the two panes. */
  separatorProps: PaneSeparatorProps;
}

/**
 * Owns the left-rail width of the two-pane shell: a pointer-drag resize, a
 * double-click reset to the default, and persistence to localStorage. The width
 * floor is MIN_RAIL_WIDTH; the ceiling is dynamic — the rail widens to the right
 * until the canvas would shrink below MIN_CANVAS_WIDTH, measured live from the
 * container (so a wider window allows a wider rail). The container is reached via
 * {@link PaneResize.containerRef}, which the shell attaches to the body.
 *
 * The drag is tracked relative to its origin (the pointer X and rail width at
 * pointerdown), so it is robust regardless of where the separator sits. Pointer
 * capture keeps the gesture flowing to the separator even when the cursor moves
 * off the thin handle; environments without pointer capture (e.g. jsdom) simply
 * skip it.
 *
 * The drag teardown is shared by pointerup, pointercancel, and lost pointer
 * capture (window blur / OS interruption) so the drag can never get stuck
 * active; a move with no button held also self-heals. The width is persisted
 * only when the gesture settles or on reset — never on every drag frame, and
 * never on mount (so the default is not pinned for users who never resize).
 *
 * On mount and on every window resize the width is re-clamped to the live
 * ceiling, so shrinking the window (or restoring a width persisted on a wider
 * one) never pushes the canvas below its minimum.
 */
export function usePaneResize(): PaneResize {
  const [railWidth, setRailWidth] = useState<number>(loadPersistedRailWidth);
  const [isDragging, setIsDragging] = useState(false);
  // Drag origin captured at pointerdown; null when no drag is in progress.
  const dragOrigin = useRef<{ pointerX: number; width: number } | null>(null);
  // Mirror the latest width so the end-of-gesture teardown can persist it
  // without re-subscribing the pointer handlers on every drag frame.
  const railWidthRef = useRef(railWidth);
  railWidthRef.current = railWidth;
  // The two-pane body; its width (minus the separator and the canvas minimum)
  // is the live ceiling the rail can grow to.
  const containerRef = useRef<HTMLDivElement>(null);

  // The largest rail width that still leaves the canvas its minimum, measured
  // from the live body and separator. +Infinity while the shell is unmeasured
  // (no container yet, or jsdom before layout) so nothing clamps to a degenerate
  // value before the real geometry is known.
  const currentMaxWidth = useCallback(() => {
    const container = containerRef.current;
    if (container === null) return Number.POSITIVE_INFINITY;
    const separator =
      container.querySelector<HTMLElement>('[role="separator"]');
    return railWidthMaxFor(
      container.getBoundingClientRect().width,
      separator?.getBoundingClientRect().width ?? 0,
    );
  }, []);

  const endDrag = useCallback(() => {
    if (dragOrigin.current === null) return;
    dragOrigin.current = null;
    setIsDragging(false);
    // Persist once the gesture settles — never mid-drag.
    persistRailWidth(railWidthRef.current);
  }, []);

  const onPointerDown = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    dragOrigin.current = {
      pointerX: event.clientX,
      width: railWidthRef.current,
    };
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent) => {
      const origin = dragOrigin.current;
      if (origin === null) return;
      // Self-heal a stuck drag: if no button is held (an interrupted gesture or
      // lost pointer capture left the drag active), end it instead of resizing
      // when the user merely hovers the separator.
      if (event.buttons === 0) {
        endDrag();
        return;
      }
      setRailWidth(
        clampRailWidth(
          origin.width + (event.clientX - origin.pointerX),
          currentMaxWidth(),
        ),
      );
    },
    [endDrag, currentMaxWidth],
  );

  const onDoubleClick = useCallback(() => {
    setRailWidth(DEFAULT_RAIL_WIDTH);
    persistRailWidth(DEFAULT_RAIL_WIDTH);
  }, []);

  // Keep the rail within the canvas-preserving ceiling as the window resizes,
  // and correct an over-wide persisted width once the shell has laid out.
  useEffect(() => {
    const clampToContainer = () => {
      setRailWidth((current) => clampRailWidth(current, currentMaxWidth()));
    };
    clampToContainer();
    window.addEventListener("resize", clampToContainer);
    return () => window.removeEventListener("resize", clampToContainer);
  }, [currentMaxWidth]);

  return {
    railWidth,
    isDragging,
    containerRef,
    separatorProps: {
      role: "separator",
      "aria-orientation": "vertical",
      "aria-label": "Resize output panel",
      onPointerDown,
      onPointerMove,
      onPointerUp: endDrag,
      onPointerCancel: endDrag,
      onLostPointerCapture: endDrag,
      onDoubleClick,
    },
  };
}
