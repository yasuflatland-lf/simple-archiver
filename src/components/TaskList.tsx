import { TaskRow } from "@/components/TaskRow";
import { useJobStore } from "@/store/jobStore";

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * TaskList renders the table chrome (header row and the empty-state fallback)
 * and delegates each draft item to a memoized {@link TaskRow}. Per-row reads of
 * progress/summary live in the rows, so a high-frequency progress tick only
 * re-renders the rows whose bytes actually changed.
 */
export function TaskList() {
  // Only the item count drives the chrome (header + which rows exist); the rows
  // themselves read everything else they need directly from the store.
  const items = useJobStore((s) => s.draft.items);

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4 text-center">
        No items yet — add files or folders to begin.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <th className="pb-2 pr-3 w-8">#</th>
            <th className="pb-2 pr-3">Kind</th>
            <th className="pb-2 pr-3">Source</th>
            <th className="pb-2 pr-3">Output</th>
            <th className="pb-2 pr-3">Status</th>
            <th className="pb-2">Reorder</th>
          </tr>
        </thead>
        <tbody>
          {items.map((_item, i) => (
            // rows are a positional, backend-ordered list with no per-row local state;
            // item paths may legitimately duplicate, so index keys are correct here.
            // oxlint-disable-next-line react/no-array-index-key
            <TaskRow index={i} key={i} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
