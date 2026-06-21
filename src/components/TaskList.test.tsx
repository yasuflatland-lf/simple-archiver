import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

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

  it("exposes an enabled drag handle for each item row when idle", () => {
    setItems(3);
    render(<TaskList />);

    for (let i = 0; i < 3; i++) {
      expect(handle(i).getAttribute("data-disabled")).toBeNull();
    }
  });

  it("calls reorder(from, to) when a row is dragged onto a lower row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2]);
    fireEvent.pointerUp(rows[2]);

    expect(reorder).toHaveBeenCalledWith(0, 2);
  });

  it("calls reorder(from, to) when a row is dragged onto a higher row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.pointerDown(handle(2));
    fireEvent.pointerMove(rows[0]);
    fireEvent.pointerUp(rows[0]);

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

  it("marks the hovered row as the drop target while dragging another row", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2]);

    expect(rows[2].getAttribute("data-drop-target")).toBe("true");
    expect(rows[0].getAttribute("data-drop-target")).toBeNull();
    expect(rows[0].getAttribute("data-dragging")).toBe("true");
  });

  it("clears the drag state when the pointer is released off the rows", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.pointerDown(handle(0));
    fireEvent.pointerMove(rows[2]);
    // Release outside any row (e.g. on the surrounding page chrome).
    fireEvent.pointerUp(document.body);

    const after = bodyRows();
    expect(after[0].getAttribute("data-dragging")).toBeNull();
    expect(after[2].getAttribute("data-drop-target")).toBeNull();
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
