import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";

// Mock the command wrappers so the store actions the hook drives resolve without
// a Tauri backend. Each reorder returns a fresh snapshot so the post-move
// `draft !== before` reference check in animateMove sees a real change.
vi.mock("@/lib/archive", () => ({
  addItems: vi.fn(),
  reorder: vi.fn(),
  removeItem: vi.fn(),
  setNamingRule: vi.fn(),
  setStartNumber: vi.fn(),
  setOutputDir: vi.fn(),
  setOutputMode: vi.fn(),
  setConflictPolicy: vi.fn(),
  clearItems: vi.fn(),
  runJob: vi.fn(),
  cancelJob: vi.fn(),
  previewOutputName: vi.fn(),
  subscribeProgress: vi.fn(),
}));
vi.mock("@/lib/output-dir-default", () => ({ persistOutputDir: vi.fn() }));

import * as archive from "@/lib/archive";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { useReorderAnimation } from "./reorder-animation";

const mockArchive = vi.mocked(archive);

function makeDraft(count: number): DraftSnapshot {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      path: `/tmp/item-${i}.rar`,
      kind: "rar" as const,
    })),
    namingTemplate: null,
    startNumber: 1,
    outputDir: null,
    outputMode: "zip",
    conflictPolicy: "autoRename",
  };
}

// Render the hook with a throwaway container. jsdom has no layout, so the FLIP
// measurement reads zero rects and Element.animate is absent — both are guarded
// in the hook — leaving the store mutation, the live announce, and the settle
// flag (the behavior under test) to run normally.
function renderAnimation() {
  const containerRef = { current: document.createElement("div") };
  return renderHook(() => useReorderAnimation(containerRef));
}

// Strip the zero-width-space the hook appends to force a live-region re-announce.
const ZERO_WIDTH_SPACE = String.fromCharCode(0x200b);
function announced(message: string): string {
  return message.split(ZERO_WIDTH_SPACE).join("");
}

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
  // A fresh object per call so the store commits a draft distinct from `before`.
  mockArchive.reorder.mockImplementation(() => Promise.resolve(makeDraft(4)));
  mockArchive.previewOutputName.mockResolvedValue("x.zip");
});

describe("useReorderAnimation grouped moves", () => {
  it("announces the moved count and shows no single-row settle flash", async () => {
    useJobStore.setState({
      draft: makeDraft(4),
      selectedIndices: [1, 2],
      selectionAnchor: 1,
    });
    const { result } = renderAnimation();

    await act(async () => {
      await result.current.animatedMoveSelected("down");
    });

    // The whole block shifted down one slot via a single backend reorder.
    expect(mockArchive.reorder).toHaveBeenCalledWith(3, 1);
    // A grouped move announces only the count (the preserved selection highlight
    // marks where the block went) and flags no single landing row.
    expect(announced(result.current.liveMessage)).toBe("Moved 2 items");
    expect(result.current.justMovedIndex).toBeNull();
  });

  it("relocates the whole selection on a drag drop and announces the count", async () => {
    useJobStore.setState({
      draft: makeDraft(5),
      selectedIndices: [1, 3],
      selectionAnchor: 1,
    });
    const { result } = renderAnimation();

    await act(async () => {
      await result.current.animatedMoveSelectedTo(5);
    });

    // The selection is gathered into a block at the bottom of the queue.
    expect(mockArchive.reorder.mock.calls).toEqual([
      [2, 1],
      [4, 2],
    ]);
    expect(announced(result.current.liveMessage)).toBe("Moved 2 items");
    expect(result.current.justMovedIndex).toBeNull();
  });

  it("suppresses the store call and the announce on a clamped no-op", async () => {
    // A selection already flush with the top edge yields an identity permutation,
    // so animateMove returns before applying: no backend reorder, no announce.
    useJobStore.setState({
      draft: makeDraft(4),
      selectedIndices: [0, 1],
      selectionAnchor: 0,
    });
    const { result } = renderAnimation();

    await act(async () => {
      await result.current.animatedMoveSelected("up");
    });

    expect(mockArchive.reorder).not.toHaveBeenCalled();
    expect(result.current.liveMessage).toBe("");
    expect(result.current.justMovedIndex).toBeNull();
  });
});

describe("useReorderAnimation single-row reorder", () => {
  it("flags the landing row and announces its 1-based position", async () => {
    useJobStore.setState({ draft: makeDraft(3) });
    mockArchive.reorder.mockImplementation(() => Promise.resolve(makeDraft(3)));
    const { result } = renderAnimation();

    await act(async () => {
      await result.current.animatedReorder(0, 2);
    });

    expect(mockArchive.reorder).toHaveBeenCalledWith(0, 2);
    // A single move flags its landing row (to) for the settle highlight and
    // announces the moved item at its new 1-based position.
    expect(result.current.justMovedIndex).toBe(2);
    expect(announced(result.current.liveMessage)).toContain("position 3");
  });

  it("is a no-op when from === to", async () => {
    useJobStore.setState({ draft: makeDraft(3) });
    const { result } = renderAnimation();

    await act(async () => {
      await result.current.animatedReorder(1, 1);
    });

    expect(mockArchive.reorder).not.toHaveBeenCalled();
    expect(result.current.justMovedIndex).toBeNull();
    expect(result.current.liveMessage).toBe("");
  });
});
