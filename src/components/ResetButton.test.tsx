import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { ResetButton } from "./ResetButton";

// Minimal DraftItemDto stub.
const ITEM = { path: "/a.rar", kind: "rar" as const };

// A draft with N items; the other fields are the store defaults.
function draftWith(items: { path: string; kind: "rar" }[]) {
  return {
    items,
    namingTemplate: null,
    startNumber: 1,
    outputDir: null,
    outputMode: "zip" as const,
    conflictPolicy: "autoRename" as const,
  };
}

describe("ResetButton – visibility", () => {
  beforeEach(() => resetJobStore());

  it("renders nothing when the queue is empty (not running)", () => {
    render(<ResetButton />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("renders nothing when the queue is empty and running", () => {
    useJobStore.setState({ running: true });
    render(<ResetButton />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("shows the action when hasItems and not running (no summary)", () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
    });
    render(<ResetButton />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeTruthy();
  });

  it("renders nothing when hasItems but running", () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: true,
      summary: null,
    });
    render(<ResetButton />);
    expect(
      screen.queryByRole("button", { name: /clear|new batch/i }),
    ).toBeNull();
  });

  it("shows the action after a job finishes (summary set, hasItems, not running)", () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
    });
    render(<ResetButton />);
    expect(screen.getByRole("button", { name: /new batch/i })).toBeTruthy();
  });
});

describe("ResetButton – label", () => {
  beforeEach(() => resetJobStore());

  it("labels the button 'Clear' when summary is null", () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
    });
    render(<ResetButton />);
    expect(screen.getByRole("button", { name: /^clear$/i })).toBeTruthy();
  });

  it("labels the button 'New batch' when summary is not null", () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: {
        succeeded: [],
        cancelled: [],
        failed: [{ taskId: 1, reason: "error" }],
        results: [],
      },
    });
    render(<ResetButton />);
    expect(screen.getByRole("button", { name: /^new batch$/i })).toBeTruthy();
  });
});

describe("ResetButton – confirm dialog", () => {
  beforeEach(() => resetJobStore());

  it("opens the dialog when the button is clicked", async () => {
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("calls reset() once when the user confirms the dialog (Clear flow)", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: /^clear$/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not call reset() when the user cancels the dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(reset).not.toHaveBeenCalled();
  });

  it("calls reset() once when confirming the 'New batch' dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^new batch$/i }));
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: /^new batch$/i }),
    );
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("does not call reset() when cancelling the 'New batch' dialog", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: { succeeded: [1], cancelled: [], failed: [], results: [] },
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^new batch$/i }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(reset).not.toHaveBeenCalled();
  });

  it("closes the dialog after confirming", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^clear$/i,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes the dialog after cancelling", async () => {
    const reset = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({
      draft: draftWith([ITEM]),
      running: false,
      summary: null,
      reset,
    });
    const user = userEvent.setup();
    render(<ResetButton />);
    await user.click(screen.getByRole("button", { name: /^clear$/i }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: /^cancel$/i,
      }),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
