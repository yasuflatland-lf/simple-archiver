import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { StatusBar } from "./StatusBar";

describe("StatusBar", () => {
  beforeEach(() => resetJobStore());

  it("shows a Ready hint when idle and empty", () => {
    render(<StatusBar />);
    expect(screen.getByText(/ready/i)).toBeTruthy();
  });

  it("shows the queued count when idle with items", () => {
    useJobStore.setState({
      draft: {
        items: [
          { path: "/a.rar", kind: "rar" },
          { path: "/b", kind: "folder" },
        ],
        namingTemplate: null,
        outputDir: null,
      },
    });
    render(<StatusBar />);
    expect(screen.getByText(/2 items queued/i)).toBeTruthy();
  });

  it("shows the overall progress bar while running", () => {
    useJobStore.setState({
      progress: {
        overall: { bytesDone: 5, bytesTotal: 10 },
        overallEtaMs: 12000,
        perTask: [],
        elapsedMs: 1000,
      },
    });
    render(<StatusBar />);
    expect(screen.getByRole("progressbar")).toBeTruthy();
  });

  it("shows the results summary when a job has finished", () => {
    useJobStore.setState({
      summary: { succeeded: [1], cancelled: [], failed: [] },
    });
    render(<StatusBar />);
    // RunSummary (PR10) renders with role="status".
    expect(screen.getByRole("status")).toBeTruthy();
  });
});
