import type { PointerEvent as ReactPointerEvent } from "react";
import { useCallback, useRef, useState } from "react";

import {
  clampRailWidth,
  DEFAULT_RAIL_WIDTH,
  loadPersistedRailWidth,
  persistRailWidth,
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
  /** The current left-rail width in px, clamped to [MIN, MAX]. */
  railWidth: number;
  /** True while a resize drag is in progress. */
  isDragging: boolean;
  /** Props to spread onto the separator element between the two panes. */
  separatorProps: PaneSeparatorProps;
}

/**
 * Owns the left-rail width of the two-pane shell: a pointer-drag resize, a
 * double-click reset to the default, and persistence to localStorage. The width
 * is always clamped to [MIN_RAIL_WIDTH, MAX_RAIL_WIDTH].
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
        clampRailWidth(origin.width + (event.clientX - origin.pointerX)),
      );
    },
    [endDrag],
  );

  const onDoubleClick = useCallback(() => {
    setRailWidth(DEFAULT_RAIL_WIDTH);
    persistRailWidth(DEFAULT_RAIL_WIDTH);
  }, []);

  return {
    railWidth,
    isDragging,
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
