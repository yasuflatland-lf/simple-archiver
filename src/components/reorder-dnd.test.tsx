import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock the command wrappers so a drop can route through the store actions (which
// the drop fires) without a Tauri backend. previewOutputName resolves to
// undefined by default, which is enough for recomputePreviews to settle.
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

import * as archive from "@/lib/archive";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { ReorderDndProvider, useReorderRow } from "./reorder-dnd";

const mockArchive = vi.mocked(archive);

// ---------------------------------------------------------------------------
// Harness
//
// These tests verify the wiring between the pointer-drag gesture and the edge
// auto-scroll loop (the loop's own math is covered in edge-autoscroll.test.ts).
// A minimal row tree built from the public hooks lets the provider's
// pointerMoveOnRow drive a stubbed scroll container through a stubbed rAF.
// ---------------------------------------------------------------------------

function Row({ index }: { index: number }) {
  const { enabled, handleProps, rowProps } = useReorderRow(index);
  return (
    <tr data-row-index={index} data-testid={`row-${index}`} {...rowProps}>
      <td>
        <span
          {...handleProps}
          data-reorder-handle
          data-testid={`handle-${index}`}
          data-disabled={!enabled || undefined}
        />
        <span>Row {index}</span>
      </td>
    </tr>
  );
}

function Harness({
  scrollContainerRef,
  count,
}: {
  scrollContainerRef?: RefObject<HTMLElement | null>;
  count: number;
}) {
  return (
    <ReorderDndProvider scrollContainerRef={scrollContainerRef}>
      <table>
        <tbody>
          {Array.from({ length: count }, (_, i) => (
            // Rows are positional with no per-row state; index keys are correct.
            // oxlint-disable-next-line react/no-array-index-key
            <Row index={i} key={i} />
          ))}
        </tbody>
      </table>
    </ReorderDndProvider>
  );
}

// A draft snapshot with `count` rar items and a null template.
function draftSnapshot(count: number) {
  return {
    items: Array.from({ length: count }, (_, i) => ({
      path: `/tmp/item-${i}.rar`,
      kind: "rar" as const,
    })),
    namingTemplate: null,
    startNumber: 1,
    outputDir: null,
    outputMode: "zip" as const,
    conflictPolicy: "autoRename" as const,
  };
}

// Seed the store so the provider's `count` / `enabled` derive from real state.
function seed(count: number, extra: Record<string, unknown> = {}) {
  useJobStore.setState({
    draft: draftSnapshot(count),
    previewNames: [],
    ...extra,
  });
}

// A scroll container spanning [top, bottom] with an observable scrollTop. jsdom
// ignores scrollTop writes, so back it with a plain accessor.
function makeScroller(top: number, bottom: number) {
  const el = document.createElement("div");
  el.getBoundingClientRect = () =>
    ({
      top,
      bottom,
      height: bottom - top,
      left: 0,
      right: 0,
      width: 0,
      x: 0,
      y: top,
      toJSON() {},
    }) as DOMRect;
  let scrollTop = 0;
  Object.defineProperty(el, "scrollTop", {
    configurable: true,
    get: () => scrollTop,
    set: (value: number) => {
      scrollTop = value;
    },
  });
  const ref: RefObject<HTMLElement | null> = { current: el };
  return { el, ref };
}

// A reduced-motion matchMedia stub (matches: true).
function stubReducedMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

let raf: ReturnType<typeof vi.fn>;
let caf: ReturnType<typeof vi.fn>;
let frames: Array<() => void>;

beforeEach(() => {
  resetJobStore();
  vi.clearAllMocks();
  // A drop fires store.reorder, which commits the returned snapshot; default it to
  // a valid draft (so it never becomes undefined) and let previews resolve.
  mockArchive.reorder.mockResolvedValue(draftSnapshot(5));
  mockArchive.previewOutputName.mockResolvedValue("x.zip");
  frames = [];
  raf = vi.fn((callback: () => void) => {
    frames.push(callback);
    return frames.length;
  });
  caf = vi.fn();
  vi.stubGlobal("requestAnimationFrame", raf);
  vi.stubGlobal("cancelAnimationFrame", caf);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  // jsdom does not define elementFromPoint; remove any per-test stub so it does
  // not leak the "function exists" branch into tests that rely on its absence.
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

// Stub document.elementFromPoint (absent in jsdom, so assign rather than spy):
// `resolve` picks the element under the pointer, letting a test model a row that
// has scrolled under a stationary pointer.
function stubElementFromPoint(resolve: () => Element | null) {
  (
    document as { elementFromPoint?: (x: number, y: number) => Element | null }
  ).elementFromPoint = () => resolve();
}

// Run the single pending animation frame (the loop reschedules a fresh one).
function flushFrame() {
  const callback = frames.shift();
  if (callback) act(() => callback());
}

// Arm a drag from row 0's grip, then move the pointer to `clientY` over a row.
function dragToY(clientY: number, overRow = 2) {
  fireEvent.pointerDown(screen.getByTestId("handle-0"));
  fireEvent.pointerMove(screen.getByTestId(`row-${overRow}`), {
    clientX: 0,
    clientY,
  });
}

describe("ReorderDndProvider edge auto-scroll", () => {
  it("scrolls the container while a row is dragged near the bottom edge", () => {
    seed(3);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    dragToY(98);
    expect(raf).toHaveBeenCalled();

    flushFrame();
    expect(el.scrollTop).toBeGreaterThan(0);
  });

  it("does not scroll when the pointer stays away from the edges", () => {
    seed(3);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    dragToY(50, 1);
    expect(raf).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(0);
  });

  it("does not scroll when no drag is active", () => {
    seed(3);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    // Move the pointer near the edge without first arming a drag.
    fireEvent.pointerMove(screen.getByTestId("row-2"), {
      clientX: 0,
      clientY: 98,
    });
    expect(raf).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(0);
  });

  it("stops auto-scrolling on drop (pointer release)", () => {
    seed(3);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    dragToY(98);
    expect(raf).toHaveBeenCalled();

    fireEvent.pointerUp(screen.getByTestId("row-2"), {
      clientX: 0,
      clientY: 98,
    });
    expect(caf).toHaveBeenCalled();

    // Any frame that survived the cancel must no longer move the container.
    const before = el.scrollTop;
    flushFrame();
    expect(el.scrollTop).toBe(before);
  });

  it("stops auto-scrolling when the pointer leaves the edge zone", () => {
    seed(3);
    const { ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    dragToY(98);
    expect(raf).toHaveBeenCalledTimes(1);

    fireEvent.pointerMove(screen.getByTestId("row-1"), {
      clientX: 0,
      clientY: 50,
    });
    expect(caf).toHaveBeenCalled();
  });

  it("is disabled under prefers-reduced-motion", () => {
    stubReducedMotion();
    seed(3);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={3} />);

    dragToY(98);
    expect(raf).not.toHaveBeenCalled();
    expect(el.scrollTop).toBe(0);
  });
});

describe("ReorderDndProvider drop lands at the scrolled-to gap", () => {
  // These cover the feature's core promise: a row can be dropped at a position
  // that started off-screen. As the edge-scroll loop moves content under a
  // stationary pointer, recomputeGapAtPointer re-resolves the drop gap via
  // elementFromPoint, and the drop must commit to THAT gap, not the one the
  // pointer last hit before scrolling.

  it("commits a single-row drop to the row revealed by the auto-scroll", async () => {
    seed(5);
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={5} />);

    // Before scrolling, the pointer sits over row 2; once the container scrolls,
    // row 4 has moved under the (stationary) pointer. Rows have zero-size rects in
    // jsdom, so recomputeGapAtPointer resolves the gap to index+1.
    stubElementFromPoint(() =>
      el.scrollTop > 0
        ? screen.getByTestId("row-4")
        : screen.getByTestId("row-2"),
    );

    // Arm a drag from row 0 and hold the pointer in the bottom edge zone.
    dragToY(98);
    expect(raf).toHaveBeenCalled();

    // One auto-scroll step moves content and re-resolves the gap to row 4 (gap 5).
    flushFrame();
    expect(el.scrollTop).toBeGreaterThan(0);

    fireEvent.pointerUp(screen.getByTestId("row-2"), {
      clientX: 0,
      clientY: 98,
    });
    await act(async () => {});

    // Single-row remove-then-insert: dropping row 0 at gap 5 maps to to = gap - 1.
    // Had the gap NOT been re-resolved during the scroll it would be 3 -> to = 2.
    expect(mockArchive.reorder).toHaveBeenCalledWith(0, 4);
  });

  it("commits a multi-row drop to the scrolled-to gap (PR #185 x #187)", async () => {
    // Selecting rows 0 and 1 and dragging the selection routes the drop through
    // moveSelectedTo(gap); with the gap re-resolved to 5 by the scroll, the block
    // is relocated to the bottom via the decomposed backend reorders.
    seed(5, { selectedIndices: [0, 1], selectionAnchor: 0 });
    const { el, ref } = makeScroller(0, 100);
    render(<Harness scrollContainerRef={ref} count={5} />);

    stubElementFromPoint(() =>
      el.scrollTop > 0
        ? screen.getByTestId("row-4")
        : screen.getByTestId("row-2"),
    );

    dragToY(98);
    flushFrame();
    expect(el.scrollTop).toBeGreaterThan(0);

    fireEvent.pointerUp(screen.getByTestId("row-2"), {
      clientX: 0,
      clientY: 98,
    });
    await act(async () => {});

    // planRelocateSelection(5, [0,1], 5) decomposes to these three reorders;
    // gap 3 (un-recomputed) would emit only [2,0].
    expect(mockArchive.reorder.mock.calls).toEqual([
      [2, 0],
      [3, 1],
      [4, 2],
    ]);
  });
});
