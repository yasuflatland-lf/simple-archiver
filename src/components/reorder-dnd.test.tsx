import { act, fireEvent, render, screen } from "@testing-library/react";
import type { RefObject } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { ReorderDndProvider, useReorderRow } from "./reorder-dnd";

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

// Seed the store so the provider's `count` / `enabled` derive from real state.
function seed(count: number, extra: Record<string, unknown> = {}) {
  useJobStore.setState({
    draft: {
      items: Array.from({ length: count }, (_, i) => ({
        path: `/tmp/item-${i}.rar`,
        kind: "rar" as const,
      })),
      namingTemplate: null,
      startNumber: 1,
      outputDir: null,
      outputMode: "zip",
      conflictPolicy: "autoRename",
    },
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
});

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
