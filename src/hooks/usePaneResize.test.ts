import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_RAIL_WIDTH,
  MAX_RAIL_WIDTH,
  MIN_RAIL_WIDTH,
  RAIL_WIDTH_STORAGE_KEY,
} from "@/lib/rail-width";

import { usePaneResize } from "./usePaneResize";

/**
 * Build a minimal stand-in for a React pointer event the hook reads from.
 * `buttons` defaults to 1 (primary button held) so a move continues a drag;
 * pass 0 to model a button-released / lost-capture move.
 */
function pointerEvent(clientX: number, buttons = 1): ReactPointerEvent {
  return {
    clientX,
    buttons,
    pointerId: 1,
    preventDefault: () => {},
    currentTarget: {
      setPointerCapture: () => {},
      releasePointerCapture: () => {},
    },
  } as unknown as ReactPointerEvent;
}

beforeEach(() => {
  localStorage.clear();
});

describe("usePaneResize", () => {
  it("starts at the default width when nothing is persisted", () => {
    const { result } = renderHook(() => usePaneResize());
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH);
    expect(result.current.isDragging).toBe(false);
  });

  it("initializes from the persisted width", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "420");
    const { result } = renderHook(() => usePaneResize());
    expect(result.current.railWidth).toBe(420);
  });

  it("exposes a non-focusable structural separator (no aria-value props)", () => {
    const { result } = renderHook(() => usePaneResize());
    const props = result.current.separatorProps;
    expect(props.role).toBe("separator");
    expect(props["aria-orientation"]).toBe("vertical");
    expect(props["aria-label"]).toBe("Resize output panel");
    expect("aria-valuenow" in props).toBe(false);
    expect("aria-valuemin" in props).toBe(false);
    expect("aria-valuemax" in props).toBe(false);
  });

  it("widens the rail as the pointer drags right", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    expect(result.current.isDragging).toBe(true);
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(160));
    });
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH + 60);
  });

  it("clamps the width while dragging past the maximum", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(0));
    });
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(5000));
    });
    expect(result.current.railWidth).toBe(MAX_RAIL_WIDTH);
  });

  it("clamps the width while dragging past the minimum", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(500));
    });
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(0));
    });
    expect(result.current.railWidth).toBe(MIN_RAIL_WIDTH);
  });

  it("ignores pointer movement when no drag is in progress", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(999));
    });
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH);
  });

  it("ends the drag and persists the width on pointer up", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(140));
    });
    act(() => {
      result.current.separatorProps.onPointerUp(pointerEvent(140));
    });
    expect(result.current.isDragging).toBe(false);
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(DEFAULT_RAIL_WIDTH + 40),
    );
  });

  it("does not persist the width mid-drag, only once it settles", () => {
    const { result } = renderHook(() => usePaneResize());
    // Nothing is written on mount — the default is never pinned.
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBeNull();
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(160));
    });
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH + 60);
    // Still unwritten while the drag is in progress.
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBeNull();
    act(() => {
      result.current.separatorProps.onPointerUp(pointerEvent(160));
    });
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(DEFAULT_RAIL_WIDTH + 60),
    );
  });

  it("ends a stuck drag on pointer cancel", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(140));
    });
    act(() => {
      result.current.separatorProps.onPointerCancel(pointerEvent(140));
    });
    expect(result.current.isDragging).toBe(false);
    // A later hover (no drag in progress) must not move the rail.
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(300));
    });
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH + 40);
  });

  it("ends a stuck drag on lost pointer capture", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current.separatorProps.onLostPointerCapture(pointerEvent(100));
    });
    expect(result.current.isDragging).toBe(false);
  });

  it("self-heals when a move arrives with no button held", () => {
    const { result } = renderHook(() => usePaneResize());
    act(() => {
      result.current.separatorProps.onPointerDown(pointerEvent(100));
    });
    // A move with no button pressed (e.g. after lost capture) must end the drag
    // rather than resize on hover.
    act(() => {
      result.current.separatorProps.onPointerMove(pointerEvent(300, 0));
    });
    expect(result.current.isDragging).toBe(false);
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH);
  });

  it("resets to the default width on double-click and persists it", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "500");
    const { result } = renderHook(() => usePaneResize());
    expect(result.current.railWidth).toBe(500);
    act(() => {
      result.current.separatorProps.onDoubleClick();
    });
    expect(result.current.railWidth).toBe(DEFAULT_RAIL_WIDTH);
    expect(localStorage.getItem(RAIL_WIDTH_STORAGE_KEY)).toBe(
      String(DEFAULT_RAIL_WIDTH),
    );
  });
});
