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
      outputStem: `item-${i}`,
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

// A container holding real <tr> nodes on a uniform grid whose rect reads, slide
// starts, and the scroll callback all append to one log, so their relative order
// can be asserted. Distinct tops matter: equal tops would make every FLIP delta
// zero and no slide would start at all.
const LOGGED_ROW_HEIGHT = 20;
function loggingContainer(rowCount: number, log: string[]): HTMLElement {
  const container = document.createElement("div");
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < rowCount; i++) {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(i);
    const top = i * LOGGED_ROW_HEIGHT;
    tr.getBoundingClientRect = () => {
      log.push("measure");
      return {
        top,
        bottom: top + LOGGED_ROW_HEIGHT,
        height: LOGGED_ROW_HEIGHT,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: top,
        toJSON() {},
      } as DOMRect;
    };
    tr.animate = () => {
      log.push("animate");
      return {
        finished: Promise.resolve(),
        cancel: () => {},
      } as unknown as Animation;
    };
    tbody.append(tr);
  }
  table.append(tbody);
  container.append(table);
  return container;
}

function renderWithScroll(scrollRowIntoView: (index: number) => void) {
  const containerRef = { current: document.createElement("div") };
  return renderHook(() => useReorderAnimation(containerRef, scrollRowIntoView));
}

describe("useReorderAnimation row visibility", () => {
  it("shows the landing row after a single-row move", async () => {
    useJobStore.setState({ draft: makeDraft(3) });
    mockArchive.reorder.mockImplementation(() => Promise.resolve(makeDraft(3)));
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedReorder(0, 2);
    });

    expect(scrollRowIntoView).toHaveBeenCalledWith(2);
  });

  it("shows the trailing row of a grouped move down", async () => {
    useJobStore.setState({
      draft: makeDraft(4),
      selectedIndices: [0, 1],
      selectionAnchor: 0,
    });
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedMoveSelected("down");
    });

    // The block lands on [1, 2]; moving down, the bottom row is the one to keep
    // in sight.
    expect(scrollRowIntoView).toHaveBeenCalledWith(2);
  });

  it("shows the leading row of a grouped move up", async () => {
    useJobStore.setState({
      draft: makeDraft(4),
      selectedIndices: [2, 3],
      selectionAnchor: 2,
    });
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedMoveSelected("up");
    });

    expect(scrollRowIntoView).toHaveBeenCalledWith(1);
  });

  it("does not scroll on a drag relocate (out of scope)", async () => {
    useJobStore.setState({
      draft: makeDraft(5),
      selectedIndices: [1, 3],
      selectionAnchor: 1,
    });
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedMoveSelectedTo(5);
    });

    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when the move clamps to a no-op", async () => {
    useJobStore.setState({
      draft: makeDraft(4),
      selectedIndices: [0, 1],
      selectionAnchor: 0,
    });
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedMoveSelected("up");
    });

    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("scrolls after the FLIP measurement but before the slides start", async () => {
    useJobStore.setState({ draft: makeDraft(3) });
    mockArchive.reorder.mockImplementation(() => Promise.resolve(makeDraft(3)));
    const log: string[] = [];
    const containerRef = { current: loggingContainer(3, log) };
    const { result } = renderHook(() =>
      useReorderAnimation(containerRef, () => {
        log.push("scroll");
      }),
    );

    await act(async () => {
      await result.current.animatedReorder(0, 2);
    });

    const scroll = log.indexOf("scroll");
    const firstAnimate = log.indexOf("animate");
    expect(scroll).toBeGreaterThan(-1);
    expect(firstAnimate).toBeGreaterThan(-1);
    // Scrolling between FLIP's before/after measurements would corrupt its
    // deltas, so every rect read must already be done.
    expect(log.lastIndexOf("measure")).toBeLessThan(scroll);
    // ...and no slide may have started yet: el.animate() composes its first
    // keyframe at the next style flush, which the scroll's own
    // getBoundingClientRect() forces, so a scroll taken after the slides start
    // reads each row's PRE-move position and lands one delta short.
    expect(scroll).toBeLessThan(firstAnimate);
  });

  it("still shows the landing row under reduced motion (no FLIP captured)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true } as MediaQueryList),
    );
    try {
      useJobStore.setState({ draft: makeDraft(3) });
      mockArchive.reorder.mockImplementation(() =>
        Promise.resolve(makeDraft(3)),
      );
      const scrollRowIntoView = vi.fn();
      const { result } = renderWithScroll(scrollRowIntoView);

      await act(async () => {
        await result.current.animatedReorder(0, 2);
      });

      // No slide was captured, so no row carries a transform — the scroll still
      // has to happen, from the (already true) layout positions.
      expect(scrollRowIntoView).toHaveBeenCalledWith(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not scroll a single-row move when the caller opts out", async () => {
    useJobStore.setState({ draft: makeDraft(3) });
    mockArchive.reorder.mockImplementation(() => Promise.resolve(makeDraft(3)));
    const scrollRowIntoView = vi.fn();
    const { result } = renderWithScroll(scrollRowIntoView);

    await act(async () => {
      await result.current.animatedReorder(0, 2, { showLandingRow: false });
    });

    // The move still lands (and still announces); only the landing scroll is
    // suppressed — this is what the drag path asks for.
    expect(mockArchive.reorder).toHaveBeenCalledWith(0, 2);
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });
});
