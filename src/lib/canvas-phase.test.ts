import { describe, expect, it } from "vitest";

import { canvasPhase } from "./canvas-phase";

describe("canvasPhase", () => {
  it("returns 'empty' when there are no items, no run, and no summary", () => {
    expect(
      canvasPhase({ itemCount: 0, running: false, hasSummary: false }),
    ).toBe("empty");
  });

  it("returns 'queued' when items exist but nothing is running and no summary", () => {
    expect(
      canvasPhase({ itemCount: 3, running: false, hasSummary: false }),
    ).toBe("queued");
  });

  it("returns 'running' while a job is in flight", () => {
    expect(
      canvasPhase({ itemCount: 3, running: true, hasSummary: false }),
    ).toBe("running");
  });

  it("returns 'results' once a summary exists and nothing is running", () => {
    expect(
      canvasPhase({ itemCount: 3, running: false, hasSummary: true }),
    ).toBe("results");
  });

  // Precedence: running > results > queued > empty.
  it("prefers 'running' over 'results' when both a run and a summary are present", () => {
    expect(canvasPhase({ itemCount: 3, running: true, hasSummary: true })).toBe(
      "running",
    );
  });

  it("prefers 'results' over 'queued' when a summary is present and not running", () => {
    expect(
      canvasPhase({ itemCount: 3, running: false, hasSummary: true }),
    ).toBe("results");
  });

  it("prefers 'running' even with no items (defensive)", () => {
    expect(
      canvasPhase({ itemCount: 0, running: true, hasSummary: false }),
    ).toBe("running");
  });

  it("prefers 'results' even with no items (a finished, then cleared, queue)", () => {
    expect(
      canvasPhase({ itemCount: 0, running: false, hasSummary: true }),
    ).toBe("results");
  });

  // After Clear, the canvas returns to the drop zone even though a fresh summary
  // is absent; the residual chip is rendered above the empty phase separately.
  it("returns 'empty' when cleared with no items, no run, and no summary", () => {
    expect(
      canvasPhase({
        itemCount: 0,
        running: false,
        hasSummary: false,
        cleared: true,
      }),
    ).toBe("empty");
  });

  it("prefers 'running' over a cleared flag (a new run started after a clear)", () => {
    expect(
      canvasPhase({
        itemCount: 0,
        running: true,
        hasSummary: false,
        cleared: true,
      }),
    ).toBe("running");
  });

  it("prefers 'results' over a cleared flag (a fresh summary supersedes the clear)", () => {
    expect(
      canvasPhase({
        itemCount: 0,
        running: false,
        hasSummary: true,
        cleared: true,
      }),
    ).toBe("results");
  });

  it("returns 'empty' when cleared even if stale items linger (defensive)", () => {
    // Clear empties the queue, but defend against a stale itemCount so the
    // cleared canvas never falls through to the queued task list.
    expect(
      canvasPhase({
        itemCount: 3,
        running: false,
        hasSummary: false,
        cleared: true,
      }),
    ).toBe("empty");
  });
});
