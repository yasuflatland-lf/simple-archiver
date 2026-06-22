import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";

import { computeFlipDeltas, reorderPermutation } from "@/components/flip";
import { basename } from "@/lib/path";
import { useJobStore } from "@/store/jobStore";

/** Slide duration (ms) for the FLIP reorder animation. */
const SLIDE_MS = 200;

/** How long the moved row stays flagged as just-moved (ms). Outlasts the CSS
 * settle keyframe so the fade completes before the flag clears. */
const HIGHLIGHT_CLEAR_MS = 800;

type AnimatedReorder = (from: number, to: number) => Promise<void>;

interface ReorderAnimationContextValue {
  animatedReorder: AnimatedReorder;
  justMovedIndex: number | null;
}

const ReorderAnimationContext =
  createContext<ReorderAnimationContextValue | null>(null);

// Fallback for a consumer rendered outside the provider (e.g. an isolated unit
// test): reorder without animation, mirroring useReorderRow's non-draggable
// fallback.
const plainReorder: AnimatedReorder = (from, to) =>
  useJobStore.getState().reorder(from, to);

/** True only when the user asked for reduced motion (and matchMedia exists). */
function prefersReducedMotion(): boolean {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface PendingFlip {
  beforeTops: number[];
  from: number;
  to: number;
}

/**
 * useReorderAnimation owns the FLIP slide for the queue table. `containerRef`
 * must point at the element wrapping the rows (the <table>); rows expose
 * `data-row-index` so their tops can be measured. Returns `animatedReorder`,
 * which both reorder paths route through.
 */
export function useReorderAnimation(
  containerRef: RefObject<HTMLElement | null>,
): {
  animatedReorder: AnimatedReorder;
  justMovedIndex: number | null;
  liveMessage: string;
} {
  // The committed draft items; a reorder swaps this reference, which is our
  // signal to play the captured FLIP once the new order has rendered.
  const items = useJobStore((s) => s.draft.items);
  // Pre-commit measurement + the move, stashed by animatedReorder and consumed
  // by the layout effect after the re-render.
  const pendingRef = useRef<PendingFlip | null>(null);
  // WAAP animations we started, tracked so a rapid second move can cancel them
  // (settling rows to their final layout) before measuring again.
  const activeRef = useRef<Set<Animation>>(new Set());
  const [justMovedIndex, setJustMovedIndex] = useState<number | null>(null);
  const [liveMessage, setLiveMessage] = useState("");
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Flips each announcement so the live-region text always differs from the
  // previous one; React bails out of an identical string update, and an
  // unchanged live region is not re-announced by assistive tech. The padding is
  // a zero-width space — invisible and not spoken — so only the DOM text changes.
  const announceSeqRef = useRef(0);

  const measureTops = useCallback((): number[] => {
    const container = containerRef.current;
    const tops: number[] = [];
    if (!container) return tops;
    container
      .querySelectorAll<HTMLElement>("tr[data-row-index]")
      .forEach((el) => {
        tops[Number(el.dataset.rowIndex)] = el.getBoundingClientRect().top;
      });
    return tops;
  }, [containerRef]);

  const settleActive = useCallback(() => {
    activeRef.current.forEach((a) => a.cancel());
    activeRef.current.clear();
  }, []);

  // Play the captured FLIP: measure the settled tops, invert each row by its
  // delta, then animate the transform back to zero so it glides into place.
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (!pending) return;
    const container = containerRef.current;
    if (!container) return;
    const afterTops: number[] = [];
    const elByIndex: HTMLElement[] = [];
    container
      .querySelectorAll<HTMLElement>("tr[data-row-index]")
      .forEach((el) => {
        const i = Number(el.dataset.rowIndex);
        afterTops[i] = el.getBoundingClientRect().top;
        elByIndex[i] = el;
      });
    const perm = reorderPermutation(pending.from, pending.to, afterTops.length);
    const deltas = computeFlipDeltas(perm, pending.beforeTops, afterTops);
    deltas.forEach((dy, newIndex) => {
      const el = elByIndex[newIndex];
      if (!dy || !el || typeof el.animate !== "function") return;
      const anim = el.animate(
        [{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }],
        { duration: SLIDE_MS, easing: "ease-out" },
      );
      activeRef.current.add(anim);
      anim.finished
        .then(() => activeRef.current.delete(anim))
        .catch(() => activeRef.current.delete(anim));
    });
  }, [items, containerRef]);

  useEffect(
    () => () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    },
    [],
  );

  const animatedReorder = useCallback<AnimatedReorder>(
    async (from, to) => {
      if (from === to) return;
      if (!prefersReducedMotion()) {
        // Settle any in-flight slide so the pre-move measurement reads true
        // layout positions, not transformed ones.
        settleActive();
        pendingRef.current = { beforeTops: measureTops(), from, to };
      }
      const before = useJobStore.getState().draft;
      const name = basename(before.items[from]?.path ?? "");
      await useJobStore.getState().reorder(from, to);
      if (useJobStore.getState().draft === before) {
        // Failed/no-op reorder: drop the capture, leave no feedback.
        pendingRef.current = null;
        return;
      }
      // The moved item now sits at `to`; flag it for the settle highlight and
      // announce the move (1-based position) to assistive tech.
      setJustMovedIndex(to);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(
        () => setJustMovedIndex(null),
        HIGHLIGHT_CLEAR_MS,
      );
      announceSeqRef.current += 1;
      const pad = "\u200B".repeat(announceSeqRef.current % 2);
      setLiveMessage(`Moved ${name} to position ${to + 1}${pad}`);
    },
    [measureTops, settleActive],
  );

  return { animatedReorder, justMovedIndex, liveMessage };
}

export function ReorderAnimationProvider({
  animatedReorder,
  justMovedIndex,
  children,
}: {
  animatedReorder: AnimatedReorder;
  justMovedIndex: number | null;
  children: ReactNode;
}) {
  const value = useMemo<ReorderAnimationContextValue>(
    () => ({ animatedReorder, justMovedIndex }),
    [animatedReorder, justMovedIndex],
  );
  return (
    <ReorderAnimationContext.Provider value={value}>
      {children}
    </ReorderAnimationContext.Provider>
  );
}

/** The animated reorder for the current context, or a plain fallback. */
export function useAnimatedReorder(): AnimatedReorder {
  const ctx = useContext(ReorderAnimationContext);
  return ctx?.animatedReorder ?? plainReorder;
}

/**
 * Per-row reorder state: the animated reorder plus whether this row is the one
 * just moved (drives the settle highlight). Falls back to a plain reorder and
 * no highlight outside the provider.
 */
export function useReorderAnimationRow(index: number): {
  animatedReorder: AnimatedReorder;
  justMoved: boolean;
} {
  const ctx = useContext(ReorderAnimationContext);
  return {
    animatedReorder: ctx?.animatedReorder ?? plainReorder,
    justMoved: ctx?.justMovedIndex === index,
  };
}
