import { Copy, Eraser, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProgressEvent } from "@/bindings/ProgressEvent";
import type { TaskResultDto } from "@/bindings/TaskResultDto";
import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { basename } from "@/lib/path";
import { copyText, openPath } from "@/lib/reveal";
import { statusVisual } from "@/lib/status";
import { useJobStore } from "@/store/jobStore";

// How long the transient "Path was copied" affordance lingers near the pointer
// after a successful per-row Copy before it fades away on its own.
const COPIED_HINT_MS = 2000;

// Run an IPC-touching action and surface a failure through the shared store
// error path rather than swallowing it, mirroring the other event handlers
// (e.g. AddSourceButtons). Keeps every Ledger handler's catch identical.
async function runOrReportError(action: () => Promise<void>) {
  try {
    await action();
  } catch (reason) {
    useJobStore.setState({ error: messageFromReason(reason) });
  }
}

/**
 * Look up a finished task's total byte size from the last progress snapshot,
 * keyed by task id. Returns null when no matching per-task entry is available
 * so the row can omit the size gracefully (size is best-effort, never blocking).
 */
function sizeForTask(
  taskId: number,
  progress: ProgressEvent | null,
): string | null {
  const entry = progress?.perTask.find((t) => t.taskId === taskId);
  if (entry === undefined) return null;
  // The terminal total is the produced file size; render it on its own scale.
  return formatBytes(entry.bytesTotal, entry.bytesTotal);
}

interface LedgerRowProps {
  /** Position in the results list, used for the source-basename lookup. */
  index: number;
  result: TaskResultDto;
  /** Source basename, resolved by the parent from draft.items[index]. */
  source: string;
  /** Best-effort produced size, or null when unknown. */
  size: string | null;
  /**
   * Raise the transient "Path was copied" affordance at the given viewport
   * coordinates after this row's path is successfully copied.
   */
  onCopied: (x: number, y: number) => void;
}

/**
 * One ledger row: `# | source → output name | size | status | Copy`.
 *
 * Copy writes the row's intended absolute output path to the clipboard; even a
 * failed row exposes it so the path can still be pasted. On success it raises a
 * transient "Path was copied" affordance at the pointer via `onCopied`.
 */
function LedgerRow({ index, result, source, size, onCopied }: LedgerRowProps) {
  const visual = statusVisual(result.status);

  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      {/* Sequence number. pl-4 matches the sticky header's px-4 inset so the row
          numbers line up with the status tally instead of hugging the card edge. */}
      <td className="py-2 pl-4 pr-3 font-mono text-muted-foreground">
        {index + 1}
      </td>

      {/* source → output name */}
      <td className="py-2 pr-3 font-mono text-foreground">
        <span className="text-muted-foreground">{source}</span>
        <span aria-hidden="true" className="px-1.5 text-muted-foreground">
          →
        </span>
        <span>{result.outputName}</span>
      </td>

      {/* Size (omitted when unknown) */}
      <td className="py-2 pr-3 font-mono text-muted-foreground">
        {size ?? ""}
      </td>

      {/* Status glyph + label; failed rows carry the reason inline */}
      <td className="py-2 pr-3">
        <span
          className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium ${visual.className}`}
        >
          <span aria-hidden="true">{visual.icon}</span>
          {visual.label}
        </span>
        {result.status === "failed" && result.reason !== null && (
          <span className="ml-2 font-mono text-status-danger-foreground">
            {result.reason}
          </span>
        )}
      </td>

      {/* Per-row actions */}
      <td className="py-2">
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Copy path of ${result.outputName}`}
            onClick={(event) => {
              // Capture the pointer position now; the synthetic event is not
              // available once the async copy resolves.
              const { clientX, clientY } = event;
              runOrReportError(async () => {
                await copyText(result.outputPath);
                onCopied(clientX, clientY);
              });
            }}
          >
            <Copy aria-hidden="true" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

/**
 * The Inline Ledger is the completion view shown in the right canvas after a job
 * finishes. It replaces the old RunSummary panel: a sticky header with the
 * status tally + an "Open folder" affordance, then one row per task carrying its
 * source → output name, produced size, status, and a per-row Copy action.
 *
 * Pure projection of the backend JobSummaryDto: the header counts are tallied
 * from `summary.results[].status` (never recomputed independently) and failure
 * reasons come verbatim from each result. Renders nothing until a summary exists.
 */
export function Ledger() {
  const summary = useJobStore((s) => s.summary);
  const progress = useJobStore((s) => s.progress);
  const items = useJobStore((s) => s.draft.items);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const clearResults = useJobStore((s) => s.clearResults);

  // Transient per-row "Path was copied" affordance, anchored at the pointer.
  // `nonce` changes the object identity on every copy so a repeat copy re-arms
  // the dismiss timer and repositions the pill even when the text is unchanged.
  const [copiedHint, setCopiedHint] = useState<{
    x: number;
    y: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (copiedHint === null) return;
    const timer = setTimeout(() => setCopiedHint(null), COPIED_HINT_MS);
    return () => clearTimeout(timer);
  }, [copiedHint]);

  if (summary === null) return null;

  const results = summary.results;
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const cancelled = results.filter((r) => r.status === "cancelled").length;
  const failed = results.filter((r) => r.status === "failed").length;

  const counts = [
    { visual: statusVisual("succeeded"), n: succeeded },
    { visual: statusVisual("cancelled"), n: cancelled },
    { visual: statusVisual("failed"), n: failed },
  ];

  const showCopiedHint = (x: number, y: number) =>
    setCopiedHint((prev) => ({ x, y, nonce: (prev?.nonce ?? 0) + 1 }));

  // <output> carries an implicit ARIA role of "status" (and implicit aria-live),
  // so the ledger is announced to assistive tech and tests resolve it via
  // getByRole("status"); keep this an <output> when refactoring.
  return (
    <>
      <output
        aria-live="polite"
        aria-label="Run summary"
        className="flex flex-col rounded-md border border-border bg-card text-sm"
      >
        {/* Sticky header: status tally + the whole-job "find my files" action. */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-card px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            {counts.map(({ visual, n }) => (
              <span
                key={visual.label}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 font-medium ${visual.className}`}
              >
                <span aria-hidden="true">{visual.icon}</span>
                {visual.label} {n}
              </span>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {/* Guarded on outputDir so it never opens a null path. */}
            {outputDir !== null && (
              <Button
                variant="outline"
                size="sm"
                aria-label="Open folder"
                onClick={() => runOrReportError(() => openPath(outputDir))}
              >
                <FolderOpen aria-hidden="true" />
                Open folder
              </Button>
            )}

            {/* Clear folds the Ledger back to the drop zone and pins the residual
              chip; it never deletes files on disk. The chip's Undo is the undo
              affordance, so there is no confirm dialog. */}
            <Button
              variant="outline"
              size="sm"
              aria-label="Clear results"
              onClick={() => runOrReportError(() => clearResults())}
            >
              <Eraser aria-hidden="true" />
              Clear
            </Button>
          </div>
        </div>

        {/* One row per task, in job order. */}
        <table className="w-full text-left">
          <tbody>
            {results.map((result, index) => (
              <LedgerRow
                key={result.taskId}
                index={index}
                result={result}
                source={basename(items[index]?.path ?? "")}
                size={sizeForTask(result.taskId, progress)}
                onCopied={showCopiedHint}
              />
            ))}
          </tbody>
        </table>
      </output>

      {/* Transient confirmation that floats in near the pointer after a Copy
          and fades on its own. Pointer-events-none so it never intercepts a
          follow-up click; its own <output> announces the copy to assistive
          tech without disturbing the run-summary region above. */}
      {copiedHint !== null && (
        <output
          key={copiedHint.nonce}
          aria-live="polite"
          className="copied-hint pointer-events-none fixed z-50 -translate-x-1/2 -translate-y-[150%] rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
          style={{ left: copiedHint.x, top: copiedHint.y }}
        >
          Path was copied
        </output>
      )}
    </>
  );
}
