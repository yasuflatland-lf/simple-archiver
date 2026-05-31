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
      },
      previewNames: ["out_001.zip"],
    });
    renderRow(0);
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("archive.rar")).toBeTruthy();
    expect(screen.getByText("rar")).toBeTruthy();
    expect(screen.getByText("out_001.zip")).toBeTruthy();
  });

  it("shows a live progress bar while running", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: null,
        outputDir: null,
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
