import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useScrollRowIntoView } from "./useScrollRowIntoView";

// jsdom has no layout, so every rect in this file is prescribed by the test.
function rect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON() {},
  } as DOMRect;
}

// A stand-in scroller: a plain object with a real, writable `scrollTop`. jsdom
// treats `scrollTop` on a real element as permanently 0 (no layout box), so the
// codebase fakes scrollers this way — see edge-autoscroll.test.ts.
function fakeScroller(top: number, bottom: number): HTMLElement {
  return {
    scrollTop: 0,
    getBoundingClientRect: () => rect(top, bottom - top),
  } as unknown as HTMLElement;
}

// A real <table> so the hook's `tr[data-row-index]` lookup is genuinely
// exercised; only the rects are stubbed. Rows are laid out on a uniform grid of
// `rowHeight` px starting at viewport y = 0.
function tableWithRows(count: number, rowHeight: number): HTMLTableElement {
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  for (let i = 0; i < count; i++) {
    const tr = document.createElement("tr");
    tr.dataset.rowIndex = String(i);
    tr.getBoundingClientRect = () => rect(i * rowHeight, rowHeight);
    tbody.append(tr);
  }
  table.append(tbody);
  return table;
}

function setup(rowCount = 10, rowHeight = 40) {
  const scroller = fakeScroller(0, 300);
  const table = tableWithRows(rowCount, rowHeight);
  const { result } = renderHook(() =>
    useScrollRowIntoView({
      tableRef: { current: table },
      scrollContainerRef: { current: scroller },
    }),
  );
  return { scroller, scrollRowIntoView: result.current };
}

describe("useScrollRowIntoView", () => {
  it("scrolls a row below the fold in, leaving one row of margin", () => {
    const { scroller, scrollRowIntoView } = setup();
    // Row 8 spans 320..360; its bottom plus a 40px margin must reach 300.
    scrollRowIntoView(8);
    expect(scroller.scrollTop).toBe(100);
  });

  it("leaves the scroll position alone for an already-visible row", () => {
    const { scroller, scrollRowIntoView } = setup();
    // Row 2 spans 80..120, comfortably inside 0..300 with its margin.
    scrollRowIntoView(2);
    expect(scroller.scrollTop).toBe(0);
  });

  it("is a no-op when the row is not rendered", () => {
    const { scroller, scrollRowIntoView } = setup(3);
    scrollRowIntoView(9);
    expect(scroller.scrollTop).toBe(0);
  });

  it("is a no-op without a scroll container", () => {
    const table = tableWithRows(3, 40);
    const { result } = renderHook(() =>
      useScrollRowIntoView({ tableRef: { current: table } }),
    );
    expect(() => result.current(2)).not.toThrow();
  });

  it("is a no-op when the table ref is null", () => {
    const scroller = fakeScroller(0, 300);
    const { result } = renderHook(() =>
      useScrollRowIntoView({
        tableRef: { current: null },
        scrollContainerRef: { current: scroller },
      }),
    );
    expect(() => result.current(2)).not.toThrow();
    expect(scroller.scrollTop).toBe(0);
  });

  it("stays referentially stable across re-renders", () => {
    const scroller = fakeScroller(0, 300);
    const table = tableWithRows(3, 40);
    const tableRef = { current: table };
    const scrollContainerRef = { current: scroller };
    const { result, rerender } = renderHook(() =>
      useScrollRowIntoView({ tableRef, scrollContainerRef }),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
