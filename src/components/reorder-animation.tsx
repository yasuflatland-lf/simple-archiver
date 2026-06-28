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
import { planRelocateSelection, planShiftSelection } from "@/lib/queue-move";
import { useJobStore } from "@/store/jobStore";

/** Slide duration (ms) for the FLIP reorder animation. */
const SLIDE_MS = 200;

/** How long the moved row stays flagged as just-moved (ms). Outlasts the CSS
 * settle keyframe so the fade completes before the flag clears. */
const HIGHLIGHT_CLEAR_MS = 800;

type AnimatedReorder = (from: number, to: number) => Promise<void>;
/** Shift the whole selection one slot up/down (keyboard / move buttons). */
type AnimatedMoveSelected = (direction: "up" | "down") => Promise<void>;
/** Relocate the whole selection to a drop gap (drag). */
type AnimatedMoveSelectedTo = (gap: number) => Promise<void>;

interface ReorderAnimationContextValue {
  animatedReorder: AnimatedReorder;
  animatedMoveSelected: AnimatedMoveSelected;
  animatedMoveSelectedTo: AnimatedMoveSelectedTo;
  justMovedIndex: number | null;
}

const ReorderAnimationContext =
  createContext<ReorderAnimationContextValue | null>(null);

// Fallbacks for a consumer rendered outside the provider (e.g. an isolated unit
// test): reorder/move without animation, mirroring useReorderRow's
// non-draggable fallback.
const plainReorder: AnimatedReorder = (from, to) =>
  useJobStore.getState().reorder(from, to);
const plainMoveSelected: AnimatedMoveSelected = (direction) =>
  useJobStore.getState().moveSelected(direction);
const plainMoveSelectedTo: AnimatedMoveSelectedTo = (gap) =>
  useJobStore.getState().moveSelectedTo(gap);

// A grouped move has no single landing row to settle-flash; the preserved
// selection highlight already marks where the block went, so only the count is
// announced to assistive tech.
function groupedAnnounce(count: number): {
  justMoved: number | null;
  message: string;
} {
  return { justMoved: null, message: `Moved ${count} items` };
}

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
  /** new index -> old index permutation the slide plays back. */
  perm: number[];
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
  animatedMoveSelected: AnimatedMoveSelected;
  animatedMoveSelectedTo: AnimatedMoveSelectedTo;
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
    const deltas = computeFlipDeltas(
      pending.perm,
      pending.beforeTops,
      afterTops,
    );
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

  // Shared FLIP runner for every reorder path: capture the pre-move tops + the
  // move's permutation, apply the store mutation, then (only if it landed) flag
  // the settle highlight and announce it. The captured perm drives the slide in
  // the layout effect above; `apply` is whatever store action commits the move.
  const animateMove = useCallback(
    async (
      perm: number[],
      apply: () => Promise<void>,
      describe: () => { justMoved: number | null; message: string },
    ): Promise<void> => {
      // An identity permutation means nothing moves (a clamped / in-place drop).
      if (perm.every((oldIndex, newIndex) => oldIndex === newIndex)) return;
      if (!prefersReducedMotion()) {
        // Settle any in-flight slide so the pre-move measurement reads true
        // layout positions, not transformed ones.
        settleActive();
        pendingRef.current = { beforeTops: measureTops(), perm };
      }
      const before = useJobStore.getState().draft;
      await apply();
      if (useJobStore.getState().draft === before) {
        // Failed/no-op move: drop the capture, leave no feedback.
        pendingRef.current = null;
        return;
      }
      const info = describe();
      // A single move flags its landing row for the settle highlight; a grouped
      // move passes null and relies on the preserved selection highlight.
      if (info.justMoved !== null) {
        setJustMovedIndex(info.justMoved);
        if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
        clearTimerRef.current = setTimeout(
          () => setJustMovedIndex(null),
          HIGHLIGHT_CLEAR_MS,
        );
      }
      announceSeqRef.current += 1;
      const pad = "\u200B".repeat(announceSeqRef.current % 2);
      setLiveMessage(`${info.message}${pad}`);
    },
    [measureTops, settleActive],
  );

  const animatedReorder = useCallback<AnimatedReorder>(
    (from, to) => {
      if (from === to) return Promise.resolve();
      const { draft } = useJobStore.getState();
      const name = basename(draft.items[from]?.path ?? "");
      return animateMove(
        reorderPermutation(from, to, draft.items.length),
        () => useJobStore.getState().reorder(from, to),
        // The moved item lands at `to`; announce the 1-based position.
        () => ({
          justMoved: to,
          message: `Moved ${name} to position ${to + 1}`,
        }),
      );
    },
    [animateMove],
  );

  const animatedMoveSelected = useCallback<AnimatedMoveSelected>(
    (direction) => {
      const { draft, selectedIndices } = useJobStore.getState();
      const plan = planShiftSelection(
        draft.items.length,
        selectedIndices,
        direction,
      );
      return animateMove(
        plan.order,
        () => useJobStore.getState().moveSelected(direction),
        () => groupedAnnounce(plan.selected.length),
      );
    },
    [animateMove],
  );

  const animatedMoveSelectedTo = useCallback<AnimatedMoveSelectedTo>(
    (gap) => {
      const { draft, selectedIndices } = useJobStore.getState();
      const plan = planRelocateSelection(
        draft.items.length,
        selectedIndices,
        gap,
      );
      return animateMove(
        plan.order,
        () => useJobStore.getState().moveSelectedTo(gap),
        () => groupedAnnounce(plan.selected.length),
      );
    },
    [animateMove],
  );

  return {
    animatedReorder,
    animatedMoveSelected,
    animatedMoveSelectedTo,
    justMovedIndex,
    liveMessage,
  };
}

export function ReorderAnimationProvider({
  animatedReorder,
  animatedMoveSelected,
  animatedMoveSelectedTo,
  justMovedIndex,
  children,
}: {
  animatedReorder: AnimatedReorder;
  animatedMoveSelected: AnimatedMoveSelected;
  animatedMoveSelectedTo: AnimatedMoveSelectedTo;
  justMovedIndex: number | null;
  children: ReactNode;
}) {
  const value = useMemo<ReorderAnimationContextValue>(
    () => ({
      animatedReorder,
      animatedMoveSelected,
      animatedMoveSelectedTo,
      justMovedIndex,
    }),
    [
      animatedReorder,
      animatedMoveSelected,
      animatedMoveSelectedTo,
      justMovedIndex,
    ],
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

/** The animated grouped relocate (drag drop), or a plain fallback. */
export function useAnimatedMoveSelectedTo(): AnimatedMoveSelectedTo {
  const ctx = useContext(ReorderAnimationContext);
  return ctx?.animatedMoveSelectedTo ?? plainMoveSelectedTo;
}

/**
 * Per-row reorder state: the single animated reorder, the grouped animated
 * shift (for the move buttons when a multi-row selection is active), and whether
 * this row is the one just moved (drives the settle highlight). Falls back to
 * plain (unanimated) moves and no highlight outside the provider.
 */
export function useReorderAnimationRow(index: number): {
  animatedReorder: AnimatedReorder;
  animatedMoveSelected: AnimatedMoveSelected;
  justMoved: boolean;
} {
  const ctx = useContext(ReorderAnimationContext);
  return {
    animatedReorder: ctx?.animatedReorder ?? plainReorder,
    animatedMoveSelected: ctx?.animatedMoveSelected ?? plainMoveSelected,
    justMoved: ctx?.justMovedIndex === index,
  };
}
