import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DraftSnapshot } from "@/bindings/DraftSnapshot";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { useSelectedRowVisibility } from "./useSelectedRowVisibility";

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

function setup() {
  const scrollRowIntoView = vi.fn();
  renderHook(() => useSelectedRowVisibility(scrollRowIntoView));
  return { scrollRowIntoView };
}

/** Commit a new selection and let the layout effect flush. */
function select(indices: number[]): void {
  act(() => {
    useJobStore.setState({
      selectedIndices: indices,
      selectionAnchor: indices.length > 0 ? indices[0] : null,
    });
  });
}

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
  useJobStore.setState({ draft: makeDraft(10) });
});

describe("useSelectedRowVisibility", () => {
  it("shows the bottommost row when the selection moves down", () => {
    const { scrollRowIntoView } = setup();
    select([3]);
    select([4, 5]);
    expect(scrollRowIntoView).toHaveBeenLastCalledWith(5);
  });

  it("shows the topmost row when the selection moves up", () => {
    const { scrollRowIntoView } = setup();
    select([4, 5]);
    select([3, 4]);
    expect(scrollRowIntoView).toHaveBeenLastCalledWith(3);
  });

  it("does not scroll on select-all", () => {
    const { scrollRowIntoView } = setup();
    act(() => {
      useJobStore.getState().selectAll();
    });
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when the selection is cleared", () => {
    const { scrollRowIntoView } = setup();
    select([3]);
    scrollRowIntoView.mockClear();
    act(() => {
      useJobStore.getState().clearSelection();
    });
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll for the selection already present at mount", () => {
    useJobStore.setState({ selectedIndices: [3], selectionAnchor: 3 });
    const { scrollRowIntoView } = setup();
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when the store rewrites the same selection into a new array", () => {
    const { scrollRowIntoView } = setup();
    select([3]);
    scrollRowIntoView.mockClear();
    act(() => {
      // A fresh array literal with the same contents: the `selectedIndices`
      // selector reference changes, so the layout effect genuinely re-runs,
      // and it is `selectionFocusIndex`'s `sameIndices` check (not a skipped
      // effect) that must suppress the scroll.
      useJobStore.setState({ selectedIndices: [3], selectionAnchor: 3 });
    });
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when the items change alongside the selection", () => {
    const { scrollRowIntoView } = setup();
    select([0, 1]);
    scrollRowIntoView.mockClear();
    act(() => {
      // What a grouped move / drag commit looks like: a fresh draft plus the
      // block's new positions in one update. The reorder path owns that
      // landing (or deliberately declines it), so this hook must stay out.
      useJobStore.setState({
        draft: makeDraft(10),
        selectedIndices: [8, 9],
        selectionAnchor: 8,
      });
    });
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });

  it("does not scroll when the item count changes but the selection does not", () => {
    const { scrollRowIntoView } = setup();
    select([3]);
    scrollRowIntoView.mockClear();
    act(() => {
      // itemCount is a dependency of the layout effect, so this re-runs it
      // with an unchanged selection.
      useJobStore.setState({ draft: makeDraft(12) });
    });
    expect(scrollRowIntoView).not.toHaveBeenCalled();
  });
});
