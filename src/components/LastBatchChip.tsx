import { FolderOpen, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { openPath } from "@/lib/reveal";
import { useJobStore } from "@/store/jobStore";

/**
 * The residual "last batch" chip: a slim pinned row shown above the drop zone
 * after a finished run is cleared. It summarizes the most recent batch
 * (`Last: N items → <destination>`) and offers two affordances:
 *   - Open: reveal the batch destination in the OS file explorer (disabled when
 *     no destination was set), and
 *   - Undo: restore the cleared run's Ledger (the chip is the sole undo path —
 *     there is no confirm dialog or toast).
 *
 * Renders nothing unless a residual batch is present. Reads `lastBatch` straight
 * from the store so it stays a pure projection of that state.
 */
export function LastBatchChip() {
  const lastBatch = useJobStore((s) => s.lastBatch);
  const restoreResults = useJobStore((s) => s.restoreResults);

  if (lastBatch === null) return null;

  const { outputDir, count } = lastBatch;
  // Pluralize the noun so "1 item" reads naturally next to "3 items".
  const itemLabel = count === 1 ? "item" : "items";

  // Surface an Open failure through the shared store error path rather than
  // swallowing it, mirroring the Ledger's handlers.
  async function openDestination() {
    if (outputDir === null) return;
    try {
      await openPath(outputDir);
    } catch (reason) {
      useJobStore.setState({ error: messageFromReason(reason) });
    }
  }

  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/40 px-4 py-2 text-sm">
      <span className="min-w-0 truncate text-muted-foreground">
        <span className="font-medium text-foreground">
          Last: {count} {itemLabel}
        </span>
        <span aria-hidden="true" className="px-1.5">
          →
        </span>
        <span className="font-mono">{outputDir ?? "(no destination)"}</span>
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {/* Disabled when no destination was set, so it never opens a null path. */}
        <Button
          variant="ghost"
          size="sm"
          aria-label="Open last batch folder"
          disabled={outputDir === null}
          onClick={openDestination}
        >
          <FolderOpen aria-hidden="true" />
          Open
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label="Undo clear"
          onClick={restoreResults}
        >
          <Undo2 aria-hidden="true" />
          Undo
        </Button>
      </div>
    </div>
  );
}
