import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { RunControls } from "./RunControls";

// Mock the archive lib so the store never hits the real Tauri backend.
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  setNamingRule: vi.fn(),
  setOutputDir: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));

beforeEach(() => {
  resetJobStore();
});

// Minimal DraftItemDto stub – only `path` and `kind` are required by the type.
const ITEM = { path: "/a.rar", kind: "rar" as const };

describe("RunControls – Run button disabled states", () => {
  it("disables Run when items is empty (outputDir is set)", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", {
      name: /run/i,
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("disables Run when outputDir is null (items present)", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", {
      name: /run/i,
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });

  it("disables Run when running is true (items + outputDir present)", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: true,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", {
      name: /run/i,
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(true);
  });
});

describe("RunControls – Run button enabled and calls runJob", () => {
  it("enables Run and calls runJob when items present, outputDir set, not running", async () => {
    const runJob = vi.fn();
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
      runJob,
    });
    const user = userEvent.setup();
    render(<RunControls />);
    const run = screen.getByRole("button", {
      name: /run/i,
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
    await user.click(run);
    expect(runJob).toHaveBeenCalledTimes(1);
  });
});

describe("RunControls – Cancel button", () => {
  it("disables Cancel when not running", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const cancel = screen.getByRole("button", {
      name: /cancel/i,
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(true);
  });

  it("enables Cancel when running", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: true,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const cancel = screen.getByRole("button", {
      name: /cancel/i,
    }) as HTMLButtonElement;
    expect(cancel.disabled).toBe(false);
  });

  it("calls cancelJob when Cancel is clicked while running", async () => {
    const cancelJob = vi.fn();
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: true,
      error: null,
      summary: null,
      cancelJob,
    });
    const user = userEvent.setup();
    render(<RunControls />);
    const cancel = screen.getByRole("button", { name: /cancel/i });
    await user.click(cancel);
    expect(cancelJob).toHaveBeenCalledTimes(1);
  });
});

