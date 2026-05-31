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

// The reason node is referenced by the Run button via aria-describedby.
function runReasonText(run: HTMLElement): string | null {
  const id = run.getAttribute("aria-describedby");
  if (!id) return null;
  return document.getElementById(id)?.textContent ?? null;
}

describe("RunControls – button visibility", () => {
  it("shows only Run when not running", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    expect(screen.getByRole("button", { name: /run/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("shows only Cancel when running", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: true,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /run/i })).toBeNull();
  });
});

describe("RunControls – Run disabled reasons (accessible)", () => {
  it("marks Run aria-disabled and describes the no-items reason", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", { name: /run/i });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(runReasonText(run)).toMatch(/add at least one item/i);
    expect(run.getAttribute("title")).toMatch(/add at least one item/i);
  });

  it("describes the no-output-dir reason when items present but outputDir null", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", { name: /run/i });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(runReasonText(run)).toMatch(/choose an output directory/i);
    expect(run.getAttribute("aria-describedby")).toBe("run-disabled-reason");
    expect(run.getAttribute("title")).toMatch(/choose an output directory/i);
  });

  it("is not aria-disabled and has no reason when ready", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", { name: /run/i });
    expect(run.getAttribute("aria-disabled")).toBeNull();
    expect(run.getAttribute("aria-describedby")).toBeNull();
    expect(run.getAttribute("title")).toBeNull();
  });
});

describe("RunControls – Run action guard", () => {
  it("does NOT call runJob when Run is clicked while disabled (no items)", async () => {
    const runJob = vi.fn();
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
      runJob,
    });
    const user = userEvent.setup();
    render(<RunControls />);
    await user.click(screen.getByRole("button", { name: /run/i }));
    expect(runJob).not.toHaveBeenCalled();
  });

  it("calls runJob when ready", async () => {
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
    await user.click(screen.getByRole("button", { name: /run/i }));
    expect(runJob).toHaveBeenCalledTimes(1);
  });

  it("does NOT call runJob when Enter is pressed while Run is disabled", async () => {
    const runJob = vi.fn();
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
      runJob,
    });
    const user = userEvent.setup();
    render(<RunControls />);
    const run = screen.getByRole("button", { name: /run/i });
    run.focus();
    await user.keyboard("{Enter}");
    expect(runJob).not.toHaveBeenCalled();
  });

  it("keeps Run focusable while disabled (aria-disabled, not native disabled)", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    const run = screen.getByRole("button", {
      name: /run/i,
    }) as HTMLButtonElement;
    expect(run.disabled).toBe(false);
  });

  it("does NOT call runJob when disabled for the no-output-dir reason", async () => {
    const runJob = vi.fn();
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: null },
      running: false,
      error: null,
      summary: null,
      runJob,
    });
    const user = userEvent.setup();
    render(<RunControls />);
    await user.click(screen.getByRole("button", { name: /run/i }));
    expect(runJob).not.toHaveBeenCalled();
  });
});

describe("RunControls – Cancel button", () => {
  it("does not render Cancel when not running", () => {
    useJobStore.setState({
      draft: { items: [ITEM], namingTemplate: null, outputDir: "/out" },
      running: false,
      error: null,
      summary: null,
    });
    render(<RunControls />);
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
  });

  it("renders Cancel and calls cancelJob when running", async () => {
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
    const cancel = screen.getByRole("button", {
      name: /cancel/i,
    }) as HTMLButtonElement;
    expect(cancel).toBeTruthy();
    await user.click(cancel);
    expect(cancelJob).toHaveBeenCalledTimes(1);
  });
});
