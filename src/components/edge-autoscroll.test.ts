import { describe, expect, it, vi } from "vitest";

import {
  type AutoScrollPorts,
  EDGE_ZONE_PX,
  EdgeAutoScroller,
  edgeScrollVelocity,
  MAX_SCROLL_SPEED_PX,
} from "./edge-autoscroll";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A scroll container spanning [top, bottom] whose scrollTop the loop mutates.
function fakeContainer(top: number, bottom: number): HTMLElement {
  return {
    scrollTop: 0,
    getBoundingClientRect: () =>
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
      }) as DOMRect,
  } as unknown as HTMLElement;
}

// Ports with a manual frame queue so a test can step the rAF loop one frame at
// a time. `flush` runs the single pending frame (the loop reschedules a fresh
// one as it ticks), mirroring how a real rAF chain advances.
function fakePorts(reduced = false) {
  const frames = new Map<number, () => void>();
  let nextId = 0;
  const requestFrame = vi.fn((callback: () => void) => {
    const id = ++nextId;
    frames.set(id, callback);
    return id;
  });
  const cancelFrame = vi.fn((handle: number) => {
    frames.delete(handle);
  });
  const ports: AutoScrollPorts = {
    requestFrame,
    cancelFrame,
    prefersReducedMotion: () => reduced,
  };
  function flush(): boolean {
    const next = frames.entries().next();
    if (next.done) return false;
    const [id, callback] = next.value;
    frames.delete(id);
    callback();
    return true;
  }
  return {
    ports,
    requestFrame,
    cancelFrame,
    flush,
    pending: () => frames.size,
  };
}

// ---------------------------------------------------------------------------
// edgeScrollVelocity (pure)
// ---------------------------------------------------------------------------

describe("edgeScrollVelocity", () => {
  const bounds = { top: 0, bottom: 200 };

  it("is zero when the pointer sits away from both edges", () => {
    expect(edgeScrollVelocity(bounds, 100)).toBe(0);
  });

  it("scrolls up (negative) inside the top edge zone", () => {
    expect(edgeScrollVelocity(bounds, 10)).toBeLessThan(0);
  });

  it("scrolls down (positive) inside the bottom edge zone", () => {
    expect(edgeScrollVelocity(bounds, 190)).toBeGreaterThan(0);
  });

  it("scales speed with proximity: closer to the edge is faster", () => {
    // Both pointers are inside the bottom zone; the one nearer the edge (199)
    // must produce a larger magnitude than the one at the inner lip (162).
    const nearEdge = edgeScrollVelocity(bounds, 199);
    const nearLip = edgeScrollVelocity(bounds, 162);
    expect(nearEdge).toBeGreaterThan(nearLip);
    expect(nearLip).toBeGreaterThan(0);
  });

  it("caps the speed at MAX past the physical edge", () => {
    // A pointer dragged beyond the bottom edge stays clamped at the max step.
    expect(edgeScrollVelocity(bounds, bounds.bottom)).toBe(MAX_SCROLL_SPEED_PX);
    expect(edgeScrollVelocity(bounds, bounds.bottom + 999)).toBe(
      MAX_SCROLL_SPEED_PX,
    );
  });

  it("treats the edge-zone width as EDGE_ZONE_PX", () => {
    // Just outside the zone -> no scroll; just inside -> scroll.
    expect(edgeScrollVelocity(bounds, bounds.bottom - EDGE_ZONE_PX)).toBe(0);
    expect(
      edgeScrollVelocity(bounds, bounds.bottom - EDGE_ZONE_PX + 1),
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// EdgeAutoScroller (loop)
// ---------------------------------------------------------------------------

describe("EdgeAutoScroller", () => {
  it("scrolls down each frame while the pointer is near the bottom edge", () => {
    const { ports, requestFrame, flush } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    expect(requestFrame).toHaveBeenCalledTimes(1);
    expect(container.scrollTop).toBe(0);

    flush();
    const afterOne = container.scrollTop;
    expect(afterOne).toBeGreaterThan(0);

    flush();
    expect(container.scrollTop).toBeGreaterThan(afterOne);
  });

  it("scrolls up (negative scrollTop delta) near the top edge", () => {
    const { ports, flush } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);
    container.scrollTop = 50;

    scroller.update(container, 2);
    flush();
    expect(container.scrollTop).toBeLessThan(50);
  });

  it("does not start a loop when the pointer is away from the edges", () => {
    const { ports, requestFrame } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 50);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
  });

  it("scales the per-frame step with pointer proximity", () => {
    const container = fakeContainer(0, 100);

    const near = fakePorts();
    const nearScroller = new EdgeAutoScroller(near.ports);
    const nearContainer = fakeContainer(0, 100);
    nearScroller.update(nearContainer, 99);
    near.flush();

    const lip = fakePorts();
    const lipScroller = new EdgeAutoScroller(lip.ports);
    const lipContainer = fakeContainer(0, 100);
    lipScroller.update(lipContainer, 62);
    lip.flush();

    expect(nearContainer.scrollTop).toBeGreaterThan(lipContainer.scrollTop);
    expect(container.scrollTop).toBe(0);
  });

  it("does not double-schedule when update fires repeatedly mid-loop", () => {
    const { ports, requestFrame } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    scroller.update(container, 96);
    scroller.update(container, 94);
    expect(requestFrame).toHaveBeenCalledTimes(1);
  });

  it("stops on drop: stop() cancels the pending frame and halts scrolling", () => {
    const { ports, cancelFrame, flush, pending } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    expect(pending()).toBe(1);

    scroller.stop();
    expect(cancelFrame).toHaveBeenCalledTimes(1);
    expect(pending()).toBe(0);

    const before = container.scrollTop;
    flush();
    expect(container.scrollTop).toBe(before);
  });

  it("stops when the pointer leaves the edge zone", () => {
    const { ports, cancelFrame } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    scroller.update(container, 50);
    expect(cancelFrame).toHaveBeenCalledTimes(1);

    const before = container.scrollTop;
    // The next tick (had it survived) must not scroll any further.
    expect(container.scrollTop).toBe(before);
  });

  it("is disabled under prefers-reduced-motion", () => {
    const { ports, requestFrame } = fakePorts(true);
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    expect(requestFrame).not.toHaveBeenCalled();
    expect(container.scrollTop).toBe(0);
  });

  it("invokes onStep after each scroll step (drop-gap refresh hook)", () => {
    const { ports, flush } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);
    const onStep = vi.fn();

    scroller.update(container, 98, onStep);
    expect(onStep).not.toHaveBeenCalled();
    flush();
    expect(onStep).toHaveBeenCalledTimes(1);
    flush();
    expect(onStep).toHaveBeenCalledTimes(2);
  });

  it("leaves no pending frame after stop (leak guard)", () => {
    const { ports, flush, pending } = fakePorts();
    const scroller = new EdgeAutoScroller(ports);
    const container = fakeContainer(0, 100);

    scroller.update(container, 98);
    flush();
    expect(pending()).toBe(1);
    scroller.stop();
    expect(pending()).toBe(0);
  });
});
