import { renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { useQueueReorderKeys } from "./useQueueReorderKeys";

// Seed the store with `itemCount` rows and a selection so the arrow handler has
// a queue to act on without a Tauri backend.
function seedQueue(itemCount: number, selectedIndices: number[]): void {
  const draft: DraftSnapshot = {
    items: Array.from({ length: itemCount }, (_, i) => ({
      path: `/tmp/item-${i}.rar`,
      kind: "rar" as const,
    })),
    namingTemplate: null,
    startNumber: 1,
    outputDir: null,
    outputMode: "zip",
    conflictPolicy: "autoRename",
  };
  useJobStore.setState({
    draft,
    selectedIndices,
    selectionAnchor: selectedIndices.length === 1 ? selectedIndices[0] : null,
  });
}

// A minimal keydown event exposing only what the handler reads, with a spy on
// preventDefault so "consumes the key" can be asserted.
function keyEvent(key: string): KeyboardEvent<HTMLElement> {
  return {
    key,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent<HTMLElement>;
}

// Render the hook with fresh spies for both move paths and return them so each
// test can assert which path fired.
function setup() {
  const animatedReorder = vi.fn().mockResolvedValue(undefined);
  const animatedMoveSelected = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() =>
    useQueueReorderKeys(animatedReorder, animatedMoveSelected),
  );
  return { handler: result.current, animatedReorder, animatedMoveSelected };
}

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
});

describe("useQueueReorderKeys — single row", () => {
  it("moves the sole selected row down on ArrowDown", () => {
    seedQueue(3, [0]);
    const { handler, animatedReorder, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowDown");
    handler(event);

    expect(animatedReorder).toHaveBeenCalledWith(0, 1);
    expect(animatedMoveSelected).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("moves the sole selected row up on ArrowUp", () => {
    seedQueue(3, [2]);
    const { handler, animatedReorder } = setup();

    const event = keyEvent("ArrowUp");
    handler(event);

    expect(animatedReorder).toHaveBeenCalledWith(2, 1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not move past the top edge but still consumes the key", () => {
    seedQueue(3, [0]);
    const { handler, animatedReorder } = setup();

    const event = keyEvent("ArrowUp");
    handler(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not move past the bottom edge but still consumes the key", () => {
    seedQueue(3, [2]);
    const { handler, animatedReorder } = setup();

    const event = keyEvent("ArrowDown");
    handler(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("useQueueReorderKeys — multi-row", () => {
  it("moves the whole selection up as a block on ArrowUp", () => {
    seedQueue(4, [1, 2]);
    const { handler, animatedReorder, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowUp");
    handler(event);

    expect(animatedMoveSelected).toHaveBeenCalledWith("up");
    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("moves the whole selection down as a block on ArrowDown", () => {
    seedQueue(4, [1, 2]);
    const { handler, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowDown");
    handler(event);

    expect(animatedMoveSelected).toHaveBeenCalledWith("down");
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("consumes the key and delegates even when clamped at the edge", () => {
    // Selection flush with the top edge: the store clamps to a no-op, but the
    // key is still consumed so the focused queue does not scroll.
    seedQueue(4, [0, 1]);
    const { handler, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowUp");
    handler(event);

    expect(animatedMoveSelected).toHaveBeenCalledWith("up");
    expect(event.preventDefault).toHaveBeenCalled();
  });
});

describe("useQueueReorderKeys — guards", () => {
  it("ignores arrows when no row is selected and leaves the key for scrolling", () => {
    seedQueue(3, []);
    const { handler, animatedReorder, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowDown");
    handler(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(animatedMoveSelected).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores arrows while a job is running", () => {
    seedQueue(4, [1, 2]);
    useJobStore.setState({ running: true });
    const { handler, animatedReorder, animatedMoveSelected } = setup();

    const event = keyEvent("ArrowDown");
    handler(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(animatedMoveSelected).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores keys other than the vertical arrows", () => {
    seedQueue(3, [0]);
    const { handler, animatedReorder, animatedMoveSelected } = setup();

    const event = keyEvent("a");
    handler(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(animatedMoveSelected).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
