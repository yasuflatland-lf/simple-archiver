import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import type { ColumnContentMeasurer } from "./column-measure";
import { COLUMN_BY_KEY, TASK_COLUMNS } from "./task-columns";
import { TaskList } from "./TaskList";

beforeEach(() => {
  resetJobStore();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    path: `/home/user/archive${i + 1}.rar`,
    kind: "rar" as const,
  }));
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe("TaskList rendering", () => {
  it("renders sequence numbers, basenames, kind badges, and preview names", () => {
    useJobStore.setState({
      draft: {
        items: [
          { path: "/home/user/folder1", kind: "folder" },
          { path: "C:\\Users\\docs\\archive.rar", kind: "rar" },
          { path: "/tmp/photos", kind: "folder" },
        ],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip", "out_002.zip", "out_003.zip"],
    });

    render(<TaskList />);

    // Sequence numbers
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();

    // Basenames
    expect(screen.getByText("folder1")).toBeTruthy();
    expect(screen.getByText("archive.rar")).toBeTruthy();
    expect(screen.getByText("photos")).toBeTruthy();

    // Kind badges
    expect(screen.getAllByText("folder").length).toBe(2);
    expect(screen.getByText("rar")).toBeTruthy();

    // Preview names
    expect(screen.getByText("out_001.zip")).toBeTruthy();
    expect(screen.getByText("out_002.zip")).toBeTruthy();
    expect(screen.getByText("out_003.zip")).toBeTruthy();
  });

  it("labels the last column header 'Actions'", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(1),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });

    render(<TaskList />);

    expect(screen.getByRole("columnheader", { name: "Actions" })).toBeTruthy();
  });

  it("renders empty state message when items list is empty", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });

    render(<TaskList />);

    expect(
      screen.getByText(/No items yet — add files or folders to begin\./i),
    ).toBeTruthy();
  });

  it("renders empty string for missing preview names", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/tmp/test.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });

    render(<TaskList />);

    // Row should still be rendered
    expect(screen.getByText("test.rar")).toBeTruthy();

    // Output cell must be empty (guards the previewNames[i] ?? "" fallback)
    const outputCell = screen.getByTestId("output-cell-0");
    expect(outputCell.textContent).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Up / Down buttons
// ---------------------------------------------------------------------------

describe("TaskList reorder buttons", () => {
  it("disables Up button on first row and Down button on last row", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });

    render(<TaskList />);

    const upButtons = screen.getAllByRole("button", {
      name: /move up/i,
    }) as HTMLButtonElement[];
    const downButtons = screen.getAllByRole("button", {
      name: /move down/i,
    }) as HTMLButtonElement[];

    // First row: Up disabled
    expect(upButtons[0].disabled).toBe(true);
    expect(downButtons[0].disabled).toBe(false);

    // Middle row: both enabled
    expect(upButtons[1].disabled).toBe(false);
    expect(downButtons[1].disabled).toBe(false);

    // Last row: Down disabled
    expect(upButtons[2].disabled).toBe(false);
    expect(downButtons[2].disabled).toBe(true);
  });

  it("calls reorder(2, 1) when Up is clicked on row index 2", async () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      reorder,
    });

    const user = userEvent.setup();
    render(<TaskList />);

    const upButtons = screen.getAllByRole("button", { name: /move up/i });
    await user.click(upButtons[2]);

    expect(reorder).toHaveBeenCalledWith(2, 1);
  });

  it("calls reorder(0, 1) when Down is clicked on row index 0", async () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      reorder,
    });

    const user = userEvent.setup();
    render(<TaskList />);

    const downButtons = screen.getAllByRole("button", { name: /move down/i });
    await user.click(downButtons[0]);

    expect(reorder).toHaveBeenCalledWith(0, 1);
  });
});

// ---------------------------------------------------------------------------
// Arrow-key reorder
// ---------------------------------------------------------------------------

describe("TaskList keyboard reorder", () => {
  function seed(
    reorder: (from: number, to: number) => Promise<void>,
    selectedIndices: number[],
  ) {
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      selectedIndices,
      selectionAnchor: selectedIndices.length === 1 ? selectedIndices[0] : null,
      reorder,
    });
  }

  it("moves the single selected row down on ArrowDown", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    seed(reorder, [0]);

    render(<TaskList />);
    fireEvent.keyDown(screen.getByTestId("queue-region"), { key: "ArrowDown" });

    expect(reorder).toHaveBeenCalledWith(0, 1);
  });

  it("moves the single selected row up on ArrowUp", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    seed(reorder, [2]);

    render(<TaskList />);
    fireEvent.keyDown(screen.getByTestId("queue-region"), { key: "ArrowUp" });

    expect(reorder).toHaveBeenCalledWith(2, 1);
  });

  it("does not reorder when no row is selected", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    seed(reorder, []);

    render(<TaskList />);
    fireEvent.keyDown(screen.getByTestId("queue-region"), { key: "ArrowDown" });

    expect(reorder).not.toHaveBeenCalled();
  });

  it("does not reorder the bottom selected row past the edge", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    seed(reorder, [2]);

    render(<TaskList />);
    fireEvent.keyDown(screen.getByTestId("queue-region"), { key: "ArrowDown" });

    expect(reorder).not.toHaveBeenCalled();
  });

  it("moves a multi-row selection as a block on ArrowDown", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    const moveSelected = vi.fn().mockResolvedValue(undefined);
    seed(reorder, [0, 1]);
    useJobStore.setState({ moveSelected });

    render(<TaskList />);
    fireEvent.keyDown(screen.getByTestId("queue-region"), { key: "ArrowDown" });

    // The whole selection shifts together; the single-row path is not used.
    expect(moveSelected).toHaveBeenCalledWith("down");
    expect(reorder).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Status column
// ---------------------------------------------------------------------------

describe("TaskList status", () => {
  it("shows Waiting when not running and no summary", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(2),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: false,
      summary: null,
      progress: null,
    });

    render(<TaskList />);

    expect(screen.getAllByText("Waiting").length).toBe(2);
  });

  it("shows a progress bar (not bytes text) when running and progress.perTask[i] exists", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(2),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: true,
      progress: {
        overall: { bytesDone: 512, bytesTotal: 1024 },
        overallEtaMs: null,
        perTask: [
          { taskId: 0, bytesDone: 256, bytesTotal: 512, etaMs: null },
          { taskId: 1, bytesDone: 100, bytesTotal: 200, etaMs: null },
        ],
        elapsedMs: 500,
      },
      summary: null,
    });

    render(<TaskList />);

    // Progress bars replace the raw bytes text when running with perTask data.
    expect(screen.getAllByRole("progressbar").length).toBe(2);
    expect(screen.queryByText("256 / 512 bytes")).toBeNull();
    expect(screen.queryByText("100 / 200 bytes")).toBeNull();
  });

  it("shows Processing when running but no matching perTask entry", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(2),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: true,
      progress: {
        overall: { bytesDone: 0, bytesTotal: 0 },
        perTask: [],
        elapsedMs: 0,
        overallEtaMs: null,
      },
      summary: null,
    });

    render(<TaskList />);

    expect(screen.getAllByText("Processing").length).toBe(2);
  });

  it("classifies Succeeded / Cancelled / Failed via taskIdByIndex", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: false,
      progress: null,
      taskIdByIndex: [10, 11, 12],
      summary: {
        succeeded: [10],
        cancelled: [11],
        failed: [{ taskId: 12, reason: "boom" }],
        results: [],
      },
    });

    render(<TaskList />);

    expect(screen.getByText("Succeeded")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
    expect(screen.getByText("Failed: boom")).toBeTruthy();
  });

  it("shows Done when summary exists but taskIdByIndex is empty", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(1),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: false,
      progress: null,
      taskIdByIndex: [],
      summary: {
        succeeded: [],
        cancelled: [],
        failed: [],
        results: [],
      },
    });

    render(<TaskList />);

    expect(screen.getByText("Done")).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Progress bar + ETA
// ---------------------------------------------------------------------------

describe("TaskList progress", () => {
  it("shows a per-row bar and ETA while running", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/tmp/a.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out1.zip"],
      running: true,
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        overallEtaMs: 12000,
        perTask: [{ taskId: 1, bytesDone: 5, bytesTotal: 10, etaMs: 12000 }],
        elapsedMs: 1000,
      },
    });

    render(<TaskList />);

    expect(screen.getByRole("progressbar")).toBeTruthy();
    expect(screen.getByText(/12s/)).toBeTruthy();
  });

  it("shows the summary status after the job finishes", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/tmp/a.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out1.zip"],
      running: false,
      taskIdByIndex: [1],
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
    });

    render(<TaskList />);

    expect(screen.getByText("Succeeded")).toBeTruthy();
  });

  it("disables reorder buttons while a job is running", () => {
    useJobStore.setState({
      draft: {
        items: makeItems(3),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      running: true,
      progress: {
        overall: { bytesDone: 0, bytesTotal: 0 },
        overallEtaMs: null,
        perTask: [],
        elapsedMs: 0,
      },
    });
    render(<TaskList />);
    const up = screen.getAllByRole("button", {
      name: /move up/i,
    }) as HTMLButtonElement[];
    const down = screen.getAllByRole("button", {
      name: /move down/i,
    }) as HTMLButtonElement[];
    // Every reorder control is disabled while running, regardless of position.
    expect(up.every((b) => b.disabled)).toBe(true);
    expect(down.every((b) => b.disabled)).toBe(true);
  });

  it("shows a human-readable byte caption under the per-row bar", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/tmp/a.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out1.zip"],
      running: true,
      progress: {
        overall: { bytesDone: 13_002_342, bytesTotal: 19_922_944 },
        overallEtaMs: 8000,
        perTask: [
          {
            taskId: 1,
            bytesDone: 13_002_342,
            bytesTotal: 19_922_944,
            etaMs: 8000,
          },
        ],
        elapsedMs: 1000,
      },
    });
    render(<TaskList />);
    expect(screen.getByText(/12\.4 \/ 19\.0 MB/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Pointer-driven reorder
//
// Rows reorder via pointer events rather than HTML5 drag-and-drop: Tauri's
// webview drag-drop handler — which the file-drop-to-add feature relies on —
// intercepts native drag gestures so the DOM `drop` event never fires in the
// app. Pointer events are not intercepted, so dragging a row by its grip handle
// reorders it. The grip starts the drag; the row under the pointer is the drop
// target; releasing the pointer commits the move.
// ---------------------------------------------------------------------------

describe("TaskList pointer reorder", () => {
  function setItems(n: number, extra: Record<string, unknown> = {}) {
    useJobStore.setState({
      draft: {
        items: makeItems(n),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      ...extra,
    });
  }

  // The first <tr> is the header; the remaining rows are the reorderable items.
  function bodyRows() {
    return screen.getAllByRole("row").slice(1) as HTMLTableRowElement[];
  }

  // The grip handle that starts a drag for the row at `index`.
  function handle(index: number) {
    return screen.getByTestId(`reorder-handle-${index}`);
  }

  // jsdom has no layout, so getBoundingClientRect returns zeros. Stub a row's rect
  // so the pointer-Y vs midpoint math (insert-above vs insert-below) is exercised.
  function stubRect(row: HTMLElement, top: number, height = 20) {
    row.getBoundingClientRect = () =>
      ({
        top,
        height,
        bottom: top + height,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON() {},
      }) as DOMRect;
  }
  // Pointer Y in the TOP half of a row whose rect starts at `top`.
  const topHalf = (top: number) => top + 4;
  // Pointer Y in the BOTTOM half of a row whose rect starts at `top`.
  const bottomHalf = (top: number) => top + 16;

  it("exposes an enabled drag handle for each item row when idle", () => {
    setItems(3);
    render(<TaskList />);

    for (let i = 0; i < 3; i++) {
      expect(handle(i).getAttribute("data-disabled")).toBeNull();
    }
  });

  it("reorders a row downward when dropped on the lower half of a lower row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    fireEvent.pointerDown(handle(0));
    // Bottom half of the last row -> gap = 3 (after last). from=0 -> to=2.
    fireEvent.pointerMove(rows[2], { clientY: bottomHalf(40) });
    fireEvent.pointerUp(rows[2], { clientY: bottomHalf(40) });

    expect(reorder).toHaveBeenCalledWith(0, 2);
  });

  it("reorders a row upward when dropped on the upper half of a higher row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[0], 0);
    fireEvent.pointerDown(handle(2));
    // Top half of the first row -> gap = 0. from=2, gap<=from -> to=0.
    fireEvent.pointerMove(rows[0], { clientY: topHalf(0) });
    fireEvent.pointerUp(rows[0], { clientY: topHalf(0) });

    expect(reorder).toHaveBeenCalledWith(2, 0);
  });

  it("does not call reorder when a row is released onto itself", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.pointerDown(handle(1));
    fireEvent.pointerUp(rows[1]);

    expect(reorder).not.toHaveBeenCalled();
  });

  it("shows a top drop-line on the row whose upper half is hovered", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2], { clientY: topHalf(40) });

    expect(rows[2].getAttribute("data-drop-edge")).toBe("top");
    expect(rows[0].getAttribute("data-dragging")).toBe("true");
    // Non-target rows must carry no insertion line.
    expect(rows[0].getAttribute("data-drop-edge")).toBeNull();
    expect(rows[1].getAttribute("data-drop-edge")).toBeNull();
  });

  it("applies the lifted grab class to the row being dragged", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    // Pressing the grip arms the drag immediately, so the row is "picked up".
    fireEvent.pointerDown(handle(0));

    expect(rows[0].className).toContain("row-dragging");
    expect(rows[1].className).not.toContain("row-dragging");
  });

  it("shows a top drop-line on an interior row hovered at its upper half", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[1], 20);
    // Drag row 0 and hover the upper half of row 1.
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[1], { clientY: topHalf(20) });

    // Only row 1 should show the insertion line.
    expect(rows[1].getAttribute("data-drop-edge")).toBe("top");
    // Row 0 is the dragged row — fix #2 ensures no line on it.
    expect(rows[0].getAttribute("data-drop-edge")).toBeNull();
    expect(rows[2].getAttribute("data-drop-edge")).toBeNull();
  });

  it("shows a bottom drop-line on the last row when its lower half is hovered", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2], { clientY: bottomHalf(40) });

    expect(rows[2].getAttribute("data-drop-edge")).toBe("bottom");
  });

  it("clears the drag state when the pointer is released off the rows", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2], { clientY: topHalf(40) });
    fireEvent.pointerUp(document.body);

    const after = bodyRows();
    expect(after[0].getAttribute("data-dragging")).toBeNull();
    expect(after[2].getAttribute("data-drop-edge")).toBeNull();
  });

  it("does not reorder while a job is running", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, {
      reorder,
      running: true,
      progress: {
        overall: { bytesDone: 0, bytesTotal: 0 },
        overallEtaMs: null,
        perTask: [],
        elapsedMs: 0,
      },
    });
    render(<TaskList />);

    expect(handle(0).getAttribute("data-disabled")).toBe("true");

    const rows = bodyRows();
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2]);
    fireEvent.pointerUp(rows[2]);

    expect(reorder).not.toHaveBeenCalled();
  });

  it("renders the grip in a dedicated leading drag column", () => {
    setItems(2);
    render(<TaskList />);

    // The drag column is first in the model and the first <col>/<td>.
    expect(TASK_COLUMNS[0].key).toBe("drag");

    const firstRow = bodyRows()[0];
    const firstCell = firstRow.querySelector("td");
    // The grip lives in the first cell of each row.
    expect(firstCell?.contains(handle(0))).toBe(true);
  });

  it("reorders when the row body is dragged past the threshold", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    // Press the row body (not the grip), then move well past 5px to arm + drop.
    fireEvent.pointerDown(rows[0], { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(rows[2], { clientX: 0, clientY: bottomHalf(40) });
    fireEvent.pointerUp(rows[2], { clientX: 0, clientY: bottomHalf(40) });

    expect(reorder).toHaveBeenCalledWith(0, 2);
  });

  it("treats a sub-threshold row-body press as a click, not a drag", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[1], 20);
    fireEvent.pointerDown(rows[0], { clientX: 0, clientY: 0 });
    // Move only 3px — below DRAG_THRESHOLD_PX (5).
    fireEvent.pointerMove(rows[1], { clientX: 0, clientY: 3 });
    fireEvent.pointerUp(rows[1], { clientX: 0, clientY: 3 });

    expect(reorder).not.toHaveBeenCalled();
  });

  it("does not start a row drag when a button in the row is pressed", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    // Press the 'Move down' button, then move the pointer over a far row.
    const moveDown = within(rows[0]).getByLabelText("Move down");
    fireEvent.pointerDown(moveDown, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(rows[2], { clientX: 0, clientY: bottomHalf(40) });
    fireEvent.pointerUp(rows[2], { clientX: 0, clientY: bottomHalf(40) });

    expect(reorder).not.toHaveBeenCalled();
  });

  // Task-3 regression: aria-roledescription, grab cursor, and conditional touch-none.

  it("marks every body row with aria-roledescription='draggable item'", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    for (const row of rows) {
      expect(row.getAttribute("aria-roledescription")).toBe("draggable item");
    }
  });

  it("applies cursor-grab at rest and never touch-none before a drag starts", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    for (const row of rows) {
      // cursor-grab must be present at rest (dnd.enabled=true, no active drag).
      expect(row.className).toContain("cursor-grab");
      // touch-none must NOT appear at rest — it must only be applied mid-drag.
      expect(row.className).not.toContain("touch-none");
    }
  });

  it("applies cursor-grabbing, touch-none, and select-none on all rows while a drag is active", () => {
    setItems(3);
    render(<TaskList />);

    // Start a drag from the grip of row 0 to arm isDraggingAny on every row.
    fireEvent.pointerDown(handle(0));

    const rows = bodyRows();
    for (const row of rows) {
      // Mid-drag: cursor switches to grabbing.
      expect(row.className).toContain("cursor-grabbing");
      // touch-none suppresses touch-scroll only while dragging.
      expect(row.className).toContain("touch-none");
      // select-none prevents text selection mid-drag.
      expect(row.className).toContain("select-none");
    }
  });

  // Task-4 regression: interior bottom-half coalesces to next row's top edge
  // (single-line-per-gap invariant), and pointercancel backstop resets drag.

  it("bottom-half hover on an interior row draws a top line on the NEXT row (single-line-per-gap invariant)", () => {
    // The insertion-gap logic maps gap g to row[g]'s top edge for interior gaps,
    // and to the last row's bottom edge for the trailing gap only.
    // Hovering the bottom half of an interior row (rows[1]) yields gap = 2, which
    // must render as rows[2].data-drop-edge="top" — NOT a bottom line on rows[1].
    // This test fails if the implementation draws "bottom" on rows[1] instead of
    // coalescing to the equivalent "top" on rows[2].
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[1], 20);

    fireEvent.pointerDown(handle(0));
    // Bottom half of interior row 1 -> gap = 1 + 1 = 2.
    fireEvent.pointerMove(rows[1], { clientY: bottomHalf(20) });

    // Gap 2 is interior (not the trailing gap), so it renders as rows[2]'s top edge.
    expect(rows[2].getAttribute("data-drop-edge")).toBe("top");
    // rows[1] must carry no insertion line (it is the hovered row, not the gap marker).
    expect(rows[1].getAttribute("data-drop-edge")).toBeNull();
    // rows[0] is the dragged row — never shows an edge.
    expect(rows[0].getAttribute("data-drop-edge")).toBeNull();
  });

  it("pointercancel mid-drag clears dragging and drop-edge state", () => {
    // The window-level pointercancel listener in ReorderDndProvider is the backstop
    // for OS-interrupt scenarios (e.g. incoming call, focus loss on mobile).
    // This test fails if that listener is absent or does not call reset().
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2], { clientY: topHalf(40) });

    // Verify drag is active before cancelling.
    expect(rows[0].getAttribute("data-dragging")).toBe("true");
    expect(rows[2].getAttribute("data-drop-edge")).toBe("top");

    // Simulate an OS-level pointer cancel (bubbles up to window).
    fireEvent.pointerCancel(document.body);

    const after = bodyRows();
    // Both dragging and drop-edge flags must be cleared after cancel.
    expect(after[0].getAttribute("data-dragging")).toBeNull();
    expect(after[2].getAttribute("data-drop-edge")).toBeNull();
  });

  it("relocates the whole selection when a selected row is dragged", () => {
    const moveSelectedTo = vi.fn().mockResolvedValue(undefined);
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, {
      reorder,
      moveSelectedTo,
      selectedIndices: [0, 1],
      selectionAnchor: 0,
    });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[2], 40);
    // Drag a row that belongs to the selection; drop after the last row (gap=3).
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2], { clientY: bottomHalf(40) });
    fireEvent.pointerUp(rows[2], { clientY: bottomHalf(40) });

    // The whole selection relocates to the gap; no single-row reorder fires.
    expect(moveSelectedTo).toHaveBeenCalledWith(3);
    expect(reorder).not.toHaveBeenCalled();
  });

  it("moves only the dragged row when it is not part of the selection", () => {
    const moveSelectedTo = vi.fn().mockResolvedValue(undefined);
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, {
      reorder,
      moveSelectedTo,
      selectedIndices: [0, 1],
      selectionAnchor: 0,
    });
    render(<TaskList />);

    const rows = bodyRows();
    stubRect(rows[0], 0);
    // Drag a NON-selected row -> single-row behavior, selection untouched.
    fireEvent.pointerDown(handle(2));
    fireEvent.pointerMove(rows[0], { clientY: topHalf(0) });
    fireEvent.pointerUp(rows[0], { clientY: topHalf(0) });

    expect(reorder).toHaveBeenCalledWith(2, 0);
    expect(moveSelectedTo).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Keyboard selection + delete
//
// The queue region owns a scoped keydown handler: Cmd/Ctrl+A selects every row,
// Delete/Backspace removes the selection, Escape clears it. The handler lives on
// the focusable queue container (not the document) so it never hijacks Cmd+A or
// Delete inside the naming-template input or elsewhere.
// ---------------------------------------------------------------------------

describe("TaskList keyboard selection", () => {
  function setItems(n: number, extra: Record<string, unknown> = {}) {
    useJobStore.setState({
      draft: {
        items: makeItems(n),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
      ...extra,
    });
  }

  function region() {
    return screen.getByTestId("queue-region");
  }

  it("selects all rows on Cmd+A", () => {
    const selectAll = vi.fn();
    setItems(3, { selectAll });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "a", metaKey: true });

    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it("selects all rows on Ctrl+A", () => {
    const selectAll = vi.fn();
    setItems(3, { selectAll });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "a", ctrlKey: true });

    expect(selectAll).toHaveBeenCalledTimes(1);
  });

  it("does not select all on a bare 'a' without a modifier", () => {
    const selectAll = vi.fn();
    setItems(3, { selectAll });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "a" });

    expect(selectAll).not.toHaveBeenCalled();
  });

  it("deletes the selection on Delete", () => {
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    setItems(3, { selectedIndices: [0, 1], deleteSelected });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "Delete" });

    expect(deleteSelected).toHaveBeenCalledTimes(1);
  });

  it("deletes the selection on Backspace", () => {
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    setItems(3, { selectedIndices: [2], deleteSelected });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "Backspace" });

    expect(deleteSelected).toHaveBeenCalledTimes(1);
  });

  it("does not delete when nothing is selected", () => {
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    setItems(3, { selectedIndices: [], deleteSelected });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "Delete" });

    expect(deleteSelected).not.toHaveBeenCalled();
  });

  it("clears the selection on Escape", () => {
    const clearSelection = vi.fn();
    setItems(3, { selectedIndices: [0], clearSelection });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "Escape" });

    expect(clearSelection).toHaveBeenCalledTimes(1);
  });

  it("ignores the shortcuts while a job is running", () => {
    const selectAll = vi.fn();
    const deleteSelected = vi.fn().mockResolvedValue(undefined);
    setItems(3, {
      selectedIndices: [0],
      selectAll,
      deleteSelected,
      running: true,
      progress: {
        overall: { bytesDone: 0, bytesTotal: 0 },
        overallEtaMs: null,
        perTask: [],
        elapsedMs: 0,
      },
    });
    render(<TaskList />);

    fireEvent.keyDown(region(), { key: "a", metaKey: true });
    fireEvent.keyDown(region(), { key: "Delete" });

    expect(selectAll).not.toHaveBeenCalled();
    expect(deleteSelected).not.toHaveBeenCalled();
  });

  it("does not respond to Cmd+A fired outside the queue region", () => {
    const selectAll = vi.fn();
    setItems(3, { selectAll });
    render(<TaskList />);

    // A keydown on the document body must not reach the scoped handler.
    fireEvent.keyDown(document.body, { key: "a", metaKey: true });

    expect(selectAll).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Column resize
// ---------------------------------------------------------------------------

describe("TaskList column resize", () => {
  function setItems(n: number) {
    useJobStore.setState({
      draft: {
        items: makeItems(n),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });
  }

  // The <col> at the same ordinal as `key` in TASK_COLUMNS.
  function colWidth(container: HTMLElement, key: string) {
    const index = TASK_COLUMNS.findIndex((c) => c.key === key);
    const cols = container.querySelectorAll("col");
    return (cols[index] as HTMLElement).style.width;
  }

  it("renders a colgroup with each column at its default width", () => {
    setItems(1);
    const { container } = render(<TaskList />);

    const cols = container.querySelectorAll("col");
    expect(cols.length).toBe(TASK_COLUMNS.length);
    expect(colWidth(container, "source")).toBe(
      `${COLUMN_BY_KEY.source.defaultWidth}px`,
    );
    expect(colWidth(container, "kind")).toBe(
      `${COLUMN_BY_KEY.kind.defaultWidth}px`,
    );
  });

  it("renders resize handles only for the resizable columns", () => {
    setItems(1);
    render(<TaskList />);

    const resizable = TASK_COLUMNS.filter((c) => c.resizable);
    expect(screen.getAllByRole("separator").length).toBe(resizable.length);

    // Fixed columns carry no handle.
    expect(screen.queryByTestId("column-resize-index")).toBeNull();
    expect(screen.queryByTestId("column-resize-actions")).toBeNull();
    // Resizable columns do.
    expect(screen.getByTestId("column-resize-source")).toBeTruthy();
    expect(
      screen.getByRole("separator", { name: "Resize Source column" }),
    ).toBeTruthy();
  });

  it("widens the Source column when its handle is dragged right", () => {
    setItems(1);
    const { container } = render(<TaskList />);

    expect(colWidth(container, "source")).toBe(
      `${COLUMN_BY_KEY.source.defaultWidth}px`,
    );

    const handle = screen.getByTestId("column-resize-source");
    fireEvent.pointerDown(handle, { clientX: 100, buttons: 1, pointerId: 1 });
    expect(handle.getAttribute("data-dragging")).toBe("true");

    fireEvent.pointerMove(handle, { clientX: 180, buttons: 1, pointerId: 1 });
    expect(colWidth(container, "source")).toBe(
      `${COLUMN_BY_KEY.source.defaultWidth + 80}px`,
    );

    fireEvent.pointerUp(handle, { clientX: 180, buttons: 1, pointerId: 1 });
    expect(handle.getAttribute("data-dragging")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Column content-fit
// ---------------------------------------------------------------------------

describe("TaskList column content-fit", () => {
  function seedItems(n: number) {
    useJobStore.setState({
      draft: {
        items: makeItems(n),
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: [],
    });
  }

  function colWidth(container: HTMLElement, key: string) {
    const index = TASK_COLUMNS.findIndex((c) => c.key === key);
    const cols = container.querySelectorAll("col");
    return (cols[index] as HTMLElement).style.width;
  }

  // A measurer whose Source result is whatever `read()` returns at call time, so
  // a test can change the measured width between renders/interactions. Robust to
  // the measurer being called more than once per fit.
  function sourceMeasurer(read: () => number | null): ColumnContentMeasurer {
    return {
      measure: (_table, columnIndex) =>
        TASK_COLUMNS[columnIndex].key === "source" ? read() : null,
    };
  }

  it("auto-fits resizable columns to their measured content width on mount", () => {
    seedItems(2);
    const measurer = sourceMeasurer(() => 250);
    const { container } = render(<TaskList measurer={measurer} />);
    // Default Source width is 360; 250 proves the mount auto-fit ran.
    expect(colWidth(container, "source")).toBe("250px");
  });

  it("re-fits columns when the item set changes", () => {
    let width = 250;
    const measurer = sourceMeasurer(() => width);
    seedItems(2);
    const { container } = render(<TaskList measurer={measurer} />);
    expect(colWidth(container, "source")).toBe("250px");

    // Adding an item re-runs the fit, picking up the new measured width.
    width = 320;
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, items: makeItems(3) },
      }));
    });
    expect(colWidth(container, "source")).toBe("320px");
  });

  it("fits a column to content when its resize handle is double-clicked", () => {
    let width = 250;
    const measurer = sourceMeasurer(() => width);
    seedItems(2);
    const { container } = render(<TaskList measurer={measurer} />);
    expect(colWidth(container, "source")).toBe("250px");

    // Double-clicking the handle re-fits to the now-narrower content width.
    width = 180;
    fireEvent.doubleClick(screen.getByTestId("column-resize-source"));
    expect(colWidth(container, "source")).toBe("180px");
  });
});

// ---------------------------------------------------------------------------
// FLIP slide
// ---------------------------------------------------------------------------

// A reorder action that actually mutates the draft so the slide's layout effect
// fires (the real store does this via the backend; here we splice locally).
function installReorderingStore(n: number) {
  const reorder = vi.fn(async (from: number, to: number) => {
    useJobStore.setState((s) => {
      const items = [...s.draft.items];
      const [moved] = items.splice(from, 1);
      items.splice(to, 0, moved);
      return { draft: { ...s.draft, items } };
    });
  });
  useJobStore.setState({
    draft: {
      items: makeItems(n),
      namingTemplate: null,
      startNumber: 1,
      outputDir: null,
      outputMode: "zip",
      conflictPolicy: "autoRename",
    },
    previewNames: [],
    reorder,
  });
  return reorder;
}

// jsdom has no Element.prototype.animate (Web Animations API), so install a mock
// to give the FLIP slide a surface to call and assert against.
function installAnimateMock() {
  const animate = vi.fn(
    (_keyframes?: unknown, _options?: unknown) =>
      ({
        finished: Promise.resolve(),
        cancel: vi.fn(),
      }) as unknown as Animation,
  );
  (HTMLElement.prototype as unknown as { animate: unknown }).animate = animate;
  return animate;
}

function restoreAnimateMock() {
  delete (HTMLElement.prototype as unknown as { animate?: unknown }).animate;
}

// A reduced-motion matchMedia stub (matches: true).
function stubReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

describe("TaskList reorder slide", () => {
  afterEach(() => {
    restoreAnimateMock();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("animates the moved rows with a translateY slide on reorder", async () => {
    // jsdom has no layout, so stand in distinct tops keyed by data-row-index.
    vi.spyOn(
      HTMLTableRowElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLElement) {
      const i = Number(this.dataset.rowIndex ?? 0);
      return { top: i * 20, height: 20 } as DOMRect;
    });
    const animate = installAnimateMock();

    installReorderingStore(3);
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getAllByRole("button", { name: /move down/i })[0]);

    await waitFor(() => expect(animate).toHaveBeenCalled());
    const [keyframes] = animate.mock.calls[0];
    expect(JSON.stringify(keyframes)).toContain("translateY");
  });

  it("does not slide when the user prefers reduced motion", async () => {
    stubReducedMotion();
    const animate = installAnimateMock();

    const reorder = installReorderingStore(3);
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getAllByRole("button", { name: /move down/i })[0]);

    await waitFor(() => expect(reorder).toHaveBeenCalledWith(0, 1));
    expect(animate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Settle highlight + announcement
// ---------------------------------------------------------------------------

describe("TaskList reorder feedback", () => {
  afterEach(() => {
    restoreAnimateMock();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("marks the moved row as just-moved then clears it", async () => {
    // Fake timers drive the clear; fireEvent (not userEvent) avoids the
    // userEvent/fake-timer interaction that hangs the async click.
    vi.useFakeTimers();
    installReorderingStore(3);
    render(<TaskList />);

    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: /move down/i })[0]);
    });

    // archive1.rar (was row 0) is now at row 1 and flagged just-moved.
    const movedRow = screen.getByText("archive1.rar").closest("tr");
    expect(movedRow?.getAttribute("data-just-moved")).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(movedRow?.getAttribute("data-just-moved")).toBeNull();
  });

  it("announces the move in the polite live region", async () => {
    installReorderingStore(3);
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getAllByRole("button", { name: /move down/i })[0]);

    await waitFor(() =>
      // Strip the zero-width re-announce pad before comparing the spoken text.
      expect(
        screen.getByTestId("reorder-live").textContent?.replace(/\u200B/g, ""),
      ).toBe("Moved archive1.rar to position 2"),
    );
  });

  it("still highlights and announces under reduced motion", async () => {
    stubReducedMotion();
    const animate = installAnimateMock();

    installReorderingStore(3);
    const user = userEvent.setup();
    render(<TaskList />);

    await user.click(screen.getAllByRole("button", { name: /move down/i })[0]);

    await waitFor(() =>
      // Strip the zero-width re-announce pad before comparing the spoken text.
      expect(
        screen.getByTestId("reorder-live").textContent?.replace(/\u200B/g, ""),
      ).toBe("Moved archive1.rar to position 2"),
    );
    const movedRow = screen.getByText("archive1.rar").closest("tr");
    expect(movedRow?.getAttribute("data-just-moved")).toBe("true");
    expect(animate).not.toHaveBeenCalled();
  });
});
