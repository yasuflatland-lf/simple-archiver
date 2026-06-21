import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

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
});
