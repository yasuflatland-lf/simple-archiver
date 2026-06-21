import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

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
// Drag-and-drop reorder
// ---------------------------------------------------------------------------

describe("TaskList drag-and-drop reorder", () => {
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

  // The first <tr> is the header; the remaining rows are the draggable items.
  function bodyRows() {
    return screen.getAllByRole("row").slice(1) as HTMLTableRowElement[];
  }

  it("marks item rows draggable when no job is running", () => {
    setItems(3);
    render(<TaskList />);

    for (const row of bodyRows()) {
      expect(row.getAttribute("draggable")).toBe("true");
    }
  });

  it("calls reorder(from, to) when a row is dropped onto a lower row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);

    expect(reorder).toHaveBeenCalledWith(0, 2);
  });

  it("calls reorder(from, to) when a row is dropped onto a higher row", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.dragStart(rows[2]);
    fireEvent.dragOver(rows[0]);
    fireEvent.drop(rows[0]);

    expect(reorder).toHaveBeenCalledWith(2, 0);
  });

  it("does not call reorder when a row is dropped onto itself", () => {
    const reorder = vi.fn().mockResolvedValue(undefined);
    setItems(3, { reorder });
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.dragStart(rows[1]);
    fireEvent.dragOver(rows[1]);
    fireEvent.drop(rows[1]);

    expect(reorder).not.toHaveBeenCalled();
  });

  it("marks the hovered row as the drop target while dragging another row", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);

    expect(rows[2].getAttribute("data-drop-target")).toBe("true");
    expect(rows[0].getAttribute("data-drop-target")).toBeNull();
    expect(rows[0].getAttribute("data-dragging")).toBe("true");
  });

  it("clears the drag state on drag end", () => {
    setItems(3);
    render(<TaskList />);

    const rows = bodyRows();
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.dragEnd(rows[0]);

    expect(rows[0].getAttribute("data-dragging")).toBeNull();
    expect(rows[2].getAttribute("data-drop-target")).toBeNull();
  });

  it("does not allow dragging while a job is running", () => {
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

    const rows = bodyRows();
    for (const row of rows) {
      expect(row.getAttribute("draggable")).toBe("false");
    }

    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);

    expect(reorder).not.toHaveBeenCalled();
  });
});
