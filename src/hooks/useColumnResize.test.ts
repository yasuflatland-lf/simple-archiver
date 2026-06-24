import { act, renderHook } from "@testing-library/react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import type { ColumnContentMeasurer } from "@/components/column-measure";
import type { TaskColumnKey } from "@/components/task-columns";
import {
  COLUMN_BY_KEY,
  MAX_COLUMN_WIDTH,
  TASK_COLUMNS,
} from "@/components/task-columns";

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

/**
 * A measurer whose per-column results are fixed by key, so the sizing logic can
 * be exercised without real layout. Columns absent from the map measure as null.
 */
function fakeMeasurer(
  byKey: Partial<Record<TaskColumnKey, number>>,
): ColumnContentMeasurer {
  return {
    measure: (_table, columnIndex) =>
      byKey[TASK_COLUMNS[columnIndex].key] ?? null,
  };
}

/** A ref to a throwaway table node; the fake measurer ignores its contents. */
function refToTable(): RefObject<HTMLTableElement | null> {
  return { current: document.createElement("table") };
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

  it("fits every resizable column to its measured content width", () => {
    const measurer = fakeMeasurer({
      kind: 70,
      source: 200,
      output: 140,
      status: 150,
    });
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    act(() => {
      result.current.fitAll();
    });
    expect(result.current.widths.kind).toBe(70);
    expect(result.current.widths.source).toBe(200);
    expect(result.current.widths.output).toBe(140);
    expect(result.current.widths.status).toBe(150);
  });

  it("clamps a fitted width to the column's [min, max] bounds", () => {
    const measurer = fakeMeasurer({ source: 50, output: 5000 });
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    act(() => {
      result.current.fitAll();
    });
    // 50 is below Source's minimum; 5000 is above the shared maximum.
    expect(result.current.widths.source).toBe(COLUMN_BY_KEY.source.minWidth);
    expect(result.current.widths.output).toBe(MAX_COLUMN_WIDTH);
  });

  it("never resizes non-resizable columns when fitting", () => {
    // Even if a width were measured for them, fixed columns keep their default.
    const measurer = fakeMeasurer({
      drag: 999,
      index: 999,
      actions: 999,
      source: 200,
    });
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    act(() => {
      result.current.fitAll();
    });
    expect(result.current.widths.drag).toBe(COLUMN_BY_KEY.drag.defaultWidth);
    expect(result.current.widths.index).toBe(COLUMN_BY_KEY.index.defaultWidth);
    expect(result.current.widths.actions).toBe(
      COLUMN_BY_KEY.actions.defaultWidth,
    );
    expect(result.current.widths.source).toBe(200);
  });

  it("skips a manually resized column when auto-fitting the rest", () => {
    const measurer = fakeMeasurer({ source: 200, output: 140 });
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    // Manually drag Source — this pins it against auto-fit.
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerDown(pointerEvent(100));
    });
    act(() => {
      result.current
        .getSeparatorProps("source")
        .onPointerMove(pointerEvent(160));
    });
    const pinned = COLUMN_BY_KEY.source.defaultWidth + 60;
    expect(result.current.widths.source).toBe(pinned);

    act(() => {
      result.current.fitAll();
    });
    // Source keeps its manual width; Output (untouched) still auto-fits.
    expect(result.current.widths.source).toBe(pinned);
    expect(result.current.widths.output).toBe(140);
  });

  it("fits a column to its measured content width on double-click", () => {
    const measurer = fakeMeasurer({ source: 200 });
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    // Widen Source well past the content width via a manual drag.
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
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth + 160,
    );
    act(() => {
      result.current.getSeparatorProps("source").onDoubleClick();
    });
    expect(result.current.widths.source).toBe(200);
  });

  it("un-pins a column fitted by double-click so it auto-fits again", () => {
    // A stateful measurer: the double-click reads 200, the later fitAll reads 300.
    let calls = 0;
    const measurer: ColumnContentMeasurer = {
      measure: (_table, columnIndex) => {
        if (TASK_COLUMNS[columnIndex].key !== "source") return null;
        calls += 1;
        return calls === 1 ? 200 : 300;
      },
    };
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    // Pin Source via a manual drag.
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
    // Double-click fits (calls=1 → 200) and un-pins.
    act(() => {
      result.current.getSeparatorProps("source").onDoubleClick();
    });
    expect(result.current.widths.source).toBe(200);
    // Now un-pinned: auto-fit re-measures it (calls=2 → 300).
    act(() => {
      result.current.fitAll();
    });
    expect(result.current.widths.source).toBe(300);
  });

  it("keeps the current width when the measurer cannot measure", () => {
    const measurer = fakeMeasurer({}); // every column measures null
    const { result } = renderHook(() =>
      useColumnResize({ tableRef: refToTable(), measurer }),
    );
    act(() => {
      result.current.fitAll();
      result.current.fitColumn("source");
    });
    expect(result.current.widths.source).toBe(
      COLUMN_BY_KEY.source.defaultWidth,
    );
  });

  it("does not fit when no table ref is provided", () => {
    const measurer = fakeMeasurer({ source: 200 });
    const { result } = renderHook(() => useColumnResize({ measurer }));
    act(() => {
      result.current.fitAll();
      result.current.fitColumn("source");
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
