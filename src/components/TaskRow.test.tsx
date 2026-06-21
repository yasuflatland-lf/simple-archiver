import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { TaskRow } from "./TaskRow";

function renderRow(index: number) {
  render(
    <table>
      <tbody>
        <TaskRow index={index} />
      </tbody>
    </table>,
  );
}

describe("TaskRow", () => {
  beforeEach(() => resetJobStore());

  it("renders the sequence number, basename, kind, and preview name", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/home/user/archive.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip"],
    });
    renderRow(0);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("archive.rar")).toBeTruthy();
    expect(screen.getByText("rar")).toBeTruthy();
    expect(screen.getByText("out_001.zip")).toBeTruthy();
  });

  it("renders the kind badge with text 'zip' for a zip item", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/home/user/archive.zip", kind: "zip" as const }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip"],
    });
    renderRow(0);
    // Badge text must be present and the badge element must exist (no crash).
    const badge = screen.getByText("zip");
    expect(badge).toBeTruthy();
    // The badge span must carry the archive category token classes — not "undefined".
    expect(badge.className).toContain("bg-category-archive-subtle");
    expect(badge.className).toContain("text-category-archive-foreground");
  });

  it("shows a live progress bar while running", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
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
    renderRow(0);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("renders a delete button labelled with the row's basename and the Trash2 icon", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/home/user/archive.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip"],
    });
    renderRow(0);

    const remove = screen.getByRole("button", {
      name: "Remove archive.rar from queue",
    });
    expect(remove).toBeTruthy();
    // lucide-react renders an inline <svg> with a class derived from the icon
    // name; assert the Trash2 glyph specifically (not the reorder ▲▼ glyphs).
    expect(remove.querySelector("svg.lucide-trash2")).toBeTruthy();
  });

  it("calls removeItem with the row index when the delete button is clicked", async () => {
    const removeItem = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: {
        items: [
          { path: "/a.rar", kind: "rar" },
          { path: "/home/user/archive.rar", kind: "rar" },
        ],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip", "out_002.zip"],
      removeItem,
    });

    const user = userEvent.setup();
    renderRow(1);

    await user.click(
      screen.getByRole("button", { name: "Remove archive.rar from queue" }),
    );

    expect(removeItem).toHaveBeenCalledWith(1);
  });

  it("disables the delete button while a job is running", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/home/user/archive.rar", kind: "rar" }],
        namingTemplate: null,
        startNumber: 1,
        outputDir: null,
        outputMode: "zip",
        conflictPolicy: "autoRename",
      },
      previewNames: ["out_001.zip"],
      running: true,
      progress: {
        overall: { bytesDone: 0, bytesTotal: 0 },
        overallEtaMs: null,
        perTask: [],
        elapsedMs: 0,
      },
    });
    renderRow(0);

    const remove = screen.getByRole("button", {
      name: "Remove archive.rar from queue",
    }) as HTMLButtonElement;
    expect(remove.disabled).toBe(true);
  });
});
