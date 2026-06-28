/**
 * Edge auto-scroll for the pointer-driven queue reorder. While a row is being
 * dragged, holding the pointer near the scroll container's top/bottom edge
 * scrolls the container continuously so a row can be dropped at a position that
 * started off-screen. The scroll speed scales with how deep the pointer sits
 * inside the edge zone, and the loop is disabled under prefers-reduced-motion.
 *
 * The velocity math is a pure function ({@link edgeScrollVelocity}) and the loop
 * itself ({@link EdgeAutoScroller}) takes its frame scheduling and the
 * reduced-motion probe as injectable ports, so both are unit-testable without a
 * real layout or a real rAF.
 */

/** Distance (px) from a scroll edge within which auto-scroll engages. */
export const EDGE_ZONE_PX = 40;
/** Slowest perceptible step (px/frame), applied at the inner lip of the zone. */
const MIN_SCROLL_SPEED_PX = 2;
/** Fastest step (px/frame), applied at (or past) the physical edge. */
export const MAX_SCROLL_SPEED_PX = 14;

/** Clamp `value` into the inclusive range [0, 1]. */
function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/** Map an edge-zone depth (px) to a per-frame scroll step (px). */
function speedForDepth(depth: number): number {
  const proximity = clamp01(depth / EDGE_ZONE_PX);
  return (
    MIN_SCROLL_SPEED_PX +
    proximity * (MAX_SCROLL_SPEED_PX - MIN_SCROLL_SPEED_PX)
  );
}

/**
 * Per-frame scroll velocity (px) for a pointer at viewport-Y `pointerY` over a
 * container spanning the vertical range [`top`, `bottom`]. Negative scrolls up,
 * positive scrolls down, and zero means the pointer is outside both edge zones.
 * The magnitude grows as the pointer nears — or passes — an edge (capped at
 * {@link MAX_SCROLL_SPEED_PX}). The top edge wins when both zones overlap on a
 * container shorter than two edge zones.
 */
export function edgeScrollVelocity(
  bounds: { top: number; bottom: number },
  pointerY: number,
): number {
  const topDepth = EDGE_ZONE_PX - (pointerY - bounds.top);
  if (topDepth > 0) return -speedForDepth(topDepth);
  const bottomDepth = EDGE_ZONE_PX - (bounds.bottom - pointerY);
  if (bottomDepth > 0) return speedForDepth(bottomDepth);
  return 0;
}

/** Frame scheduling + reduced-motion probe, injectable so tests can drive them. */
export interface AutoScrollPorts {
  requestFrame: (callback: () => void) => number;
  cancelFrame: (handle: number) => void;
  prefersReducedMotion: () => boolean;
}

/** Production ports bound to the browser's rAF and matchMedia. */
export function browserAutoScrollPorts(): AutoScrollPorts {
  return {
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
    prefersReducedMotion: () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

/**
 * EdgeAutoScroller runs a rAF velocity loop that scrolls a container while the
 * pointer hovers near its top/bottom edge. {@link update} is called on every
 * pointer move during a drag; {@link stop} is called on drop, on leaving the
 * edge zone, and on unmount so the loop never leaks. Each scroll step invokes an
 * optional `onStep` callback so the caller can refresh derived state (e.g. the
 * drop-gap indicator) as content moves under a stationary pointer.
 */
export class EdgeAutoScroller {
  private container: HTMLElement | null = null;
  private velocity = 0;
  private frame: number | null = null;
  private onStep: (() => void) | null = null;

  constructor(private readonly ports: AutoScrollPorts) {}

  /**
   * Aim the scroller at `container` for a pointer at viewport-Y `pointerY`.
   * Starts the loop when the pointer is inside an edge zone and stops it
   * otherwise. A no-op (and immediate stop) when reduced motion is requested.
   */
  update(container: HTMLElement, pointerY: number, onStep?: () => void): void {
    if (this.ports.prefersReducedMotion()) {
      this.stop();
      return;
    }
    this.container = container;
    this.onStep = onStep ?? null;
    this.velocity = edgeScrollVelocity(
      container.getBoundingClientRect(),
      pointerY,
    );
    if (this.velocity === 0) {
      this.stop();
      return;
    }
    // Schedule the loop only if one is not already pending; a running loop
    // simply picks up the freshly computed velocity on its next tick.
    if (this.frame === null) {
      this.frame = this.ports.requestFrame(this.tick);
    }
  }

  /** Halt scrolling and release any pending frame (drop / leave-edge / unmount). */
  stop(): void {
    this.velocity = 0;
    this.onStep = null;
    if (this.frame !== null) {
      this.ports.cancelFrame(this.frame);
      this.frame = null;
    }
  }

  private readonly tick = (): void => {
    this.frame = null;
    const container = this.container;
    if (container === null || this.velocity === 0) return;
    container.scrollTop += this.velocity;
    this.onStep?.();
    this.frame = this.ports.requestFrame(this.tick);
  };
}
