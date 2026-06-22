import { renderHook } from "@testing-library/react";
import type { KeyboardEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { useQueueReorderKeys } from "./useQueueReorderKeys";

// Seed the store with `itemCount` rows and a single (or no) selection so the
// arrow handler has a queue to act on without a Tauri backend.
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

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
});

describe("useQueueReorderKeys", () => {
  it("moves the sole selected row down on ArrowDown", () => {
    seedQueue(3, [0]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowDown");
    result.current(event);

    expect(animatedReorder).toHaveBeenCalledWith(0, 1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("moves the sole selected row up on ArrowUp", () => {
    seedQueue(3, [2]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowUp");
    result.current(event);

    expect(animatedReorder).toHaveBeenCalledWith(2, 1);
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not move past the top edge but still consumes the key", () => {
    seedQueue(3, [0]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowUp");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("does not move past the bottom edge but still consumes the key", () => {
    seedQueue(3, [2]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowDown");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).toHaveBeenCalled();
  });

  it("ignores arrows when no row is selected and leaves the key for scrolling", () => {
    seedQueue(3, []);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowDown");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores arrows when more than one row is selected", () => {
    seedQueue(3, [0, 1]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowDown");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores arrows while a job is running", () => {
    seedQueue(3, [0]);
    useJobStore.setState({ running: true });
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("ArrowDown");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("ignores keys other than the vertical arrows", () => {
    seedQueue(3, [0]);
    const animatedReorder = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useQueueReorderKeys(animatedReorder));

    const event = keyEvent("a");
    result.current(event);

    expect(animatedReorder).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
