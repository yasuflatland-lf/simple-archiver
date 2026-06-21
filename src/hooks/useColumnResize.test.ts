import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { COLUMN_BY_KEY, MAX_COLUMN_WIDTH } from "@/components/task-columns";

import { useColumnResize } from "./useColumnResize";

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

describe("useColumnResize", () => {
  it("starts every column at its default width with no active drag", () => {
    const { result } = renderHook(() => useColumnResize());
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
    expect(result.current.widths.kind).toBe(COLUMN_BY_KEY.kind.defaultWidth);
    expect(result.current.draggingKey).toBeNull();
  });

  it("exposes a non-focusable structural separator (no aria-value props)", () => {
    const { result } = renderHook(() => useColumnResize());
    const props = result.current.getSeparatorProps("source");
    expect(props.role).toBe("separator");
    expect(props["aria-orientation"]).toBe("vertical");
    expect(props["aria-label"]).toBe("Resize Source column");
    expect("aria-valuenow" in props).toBe(false);
    expect("aria-valuemin" in props).toBe(false);
    expect("aria-valuemax" in props).toBe(false);
  });

  it("widens a column as its handle drags right", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    expect(result.current.draggingKey).toBe("source");
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(160));
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth + 60,
    );
  });

  it("narrows a column as its handle drags left", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(200));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(160));
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth - 40,
    );
  });

  it("clamps the width while dragging past the column minimum", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(500));
    });
    act(() => {
      result.current.getSeparatorProps("source").onPointerMove(pointerEvent(0));
    });
    expect(result.current.widths.source).toBe(COLUMN_BY_KEY.source.minWidth);
  });

  it("clamps the width while dragging past the maximum", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current.getSeparatorProps("source").onPointerDown(pointerEvent(0));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(9000));
    });
    expect(result.current.widths.source).toBe(MAX_COLUMN_WIDTH);
  });

  it("resizes only the dragged column, leaving the others untouched", () => {
    const { result } = renderHook(() => useColumnResize());
    const outputBefore = result.current.widths.output;
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(180));
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth + 80,
    );
    expect(result.current.widths.output).toBe(outputBefore);
  });

  it("ignores a move for a column whose handle is not the active drag", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    // A stray move on a different column's handle must not resize it.
    act(() => {
      result.current
        .getSeparatorProps("output")
        .onPointerMove(pointerEvent(400));
    });
    expect(result.current.widths.output).toBe(
      COLUMN_BY_KEY.output.defaultWidth,
    );
  });

  it("ignores pointer movement when no drag is in progress", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(999));
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
  });

  it("ends the drag on pointer up", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(140));
    });
    act(() => {
      result.current.getSeparatorProps("source").onPointerUp(pointerEvent(140));
    });
    expect(result.current.draggingKey).toBeNull();
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth + 40,
    );
  });

  it("ends a stuck drag on pointer cancel", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerCancel(pointerEvent(140));
    });
    expect(result.current.draggingKey).toBeNull();
    // A later hover (no drag in progress) must not move the column.
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(300));
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
  });

  it("ends a stuck drag on lost pointer capture", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onLostPointerCapture(pointerEvent(100));
    });
    expect(result.current.draggingKey).toBeNull();
  });

  it("self-heals when a move arrives with no button held", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(300, 0));
    });
    expect(result.current.draggingKey).toBeNull();
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
  });

  it("resets a column to its default width on double-click", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(260));
    });
    expect(result.current.widths.source).not.toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
    act(() => {
      result.current.getSeparatorProps("source").onDoubleClick();
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
  });

  it("keeps widths in-session only — never writes to localStorage", () => {
    const { result } = renderHook(() => useColumnResize());
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(180));
    });
    act(() => {
      result.current.getSeparatorProps("source").onPointerUp(pointerEvent(180));
    });
    act(() => {
      result.current.getSeparatorProps("source").onDoubleClick();
    });
    // Nothing about column widths is ever persisted.
    expect(localStorage.length).toBe(0);
  });
});
