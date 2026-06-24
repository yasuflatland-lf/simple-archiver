import { Check, Copy, Delete, FolderOpen } from "lucide-react";
import { useEffect, useState } from "react";

import type { ProgressEvent } from "@/bindings/ProgressEvent";
import type { TaskResultDto } from "@/bindings/TaskResultDto";
import { Button } from "@/components/ui/button";
import { messageFromReason } from "@/lib/errors";
import { formatBytes } from "@/lib/format";
import { basename } from "@/lib/path";
import { copyText, openPath } from "@/lib/reveal";
import { statusVisual, type TaskOutcome } from "@/lib/status";
import { useJobStore } from "@/store/jobStore";

// How long the "Copied" popup stays before it fades out and is removed. Mirrors
// the copied-pop animation duration in App.css so the node is dropped just as the
// fade completes.
const COPIED_HINT_MS = 1500;

// Outcome groups render in action-first order: failures first so the rows a user
// must act on lead; successes last.
const GROUP_ORDER: TaskOutcome[] = ["failed", "cancelled", "succeeded"];

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
  /** Original job-order position (preserved across grouping) for the number cell. */
  index: number;
  result: TaskResultDto;
  /** Source basename, resolved by the parent from draft.items[index]. */
  source: string;
  /** Best-effort produced size, or null when unknown. */
  size: string | null;
  /** When non-null, this row shows its transient "Copied" popup. The nonce keys
   *  the popup so a repeat copy on the same row replays the pop-in animation. */
  copiedNonce: number | null;
  /** Copy the row's output path and raise the in-row confirmation. */
  onCopy: (taskId: number, outputPath: string) => void;
}

/**
 * One ledger row: `# | source → output name | size-or-reason | Copy`.
 *
 * The per-row status is conveyed by the enclosing outcome group, so the row
 * carries no status chip. Failed rows render their reason in place of the size.
 * Copy writes the row's intended absolute output path to the clipboard; even a
 * failed row exposes it so the path can still be pasted. On success a small
 * "Copied" popup pops in over the button and fades out on its own.
 */
function LedgerRow({
  index,
  result,
  source,
  size,
  copiedNonce,
  onCopy,
}: LedgerRowProps) {
  return (
    <tr className="border-b border-border/50 hover:bg-muted/30 transition-colors">
      {/* Sequence number. pl-4 matches the header's px-4 inset so the row numbers
          line up with the header instead of hugging the card edge. */}
      <td className="py-2 pl-4 pr-3 font-mono text-muted-foreground">
        {index + 1}
      </td>

      {/* source → output name. w-full makes this the single greedy column that
          absorbs the row's slack, so the size and Copy columns fit their content
          and pack to the right edge instead of the width being spread across all
          columns. */}
      <td className="w-full py-2 pr-3 font-mono text-foreground">
        <span className="text-muted-foreground">{source}</span>
        <span aria-hidden="true" className="px-1.5 text-muted-foreground">
          →
        </span>
        <span>{result.outputName}</span>
      </td>

      {/* size for non-failed rows; the failure reason (emphasised) for failed rows.
          whitespace-nowrap keeps the size on one line so it fits its content and
          stays aligned with Copy at the right. */}
      <td className="py-2 pr-3 font-mono text-xs whitespace-nowrap">
        {result.status === "failed" ? (
          <span className="text-status-danger-foreground">{result.reason}</span>
        ) : (
          <span className="text-muted-foreground">{size ?? ""}</span>
        )}
      </td>

      {/* Per-row Copy action with a transient "Copied" popup confirmation. */}
      <td className="py-2 pr-4">
        <div className="relative flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Copy path of ${result.outputName}`}
            onClick={() => onCopy(result.taskId, result.outputPath)}
          >
            <Copy aria-hidden="true" />
          </Button>

          {/* Decorative pop-in confirmation anchored above the button; the polite
              announcement for assistive tech is the sr-only <output> in Ledger.
              Keyed by nonce so a repeat copy replays the fade animation. */}
          {copiedNonce !== null && (
            <span
              key={copiedNonce}
              aria-hidden="true"
              className="copied-popup pointer-events-none absolute bottom-full right-0 z-20 mb-1 flex items-center gap-1 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-xs font-medium text-popover-foreground shadow-md"
            >
              <Check
                aria-hidden="true"
                className="size-3.5 text-status-success-foreground"
              />
              Copied
            </span>
          )}
        </div>
      </td>
    </tr>
  );
}

/**
 * The Inline Ledger is the completion view shown in the right canvas after a job
 * finishes. Results are grouped by outcome (failures first), each group labelled
 * with its count, and every row carries a per-row Copy action.
 *
 * Pure projection of the backend JobSummaryDto: the counts are tallied from
 * `summary.results[].status` (never recomputed independently) and failure
 * reasons come verbatim from each result. Renders nothing until a summary exists.
 */
export function Ledger() {
  const summary = useJobStore((s) => s.summary);
  const progress = useJobStore((s) => s.progress);
  const items = useJobStore((s) => s.draft.items);
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const clearResults = useJobStore((s) => s.clearResults);

  // The task id whose row currently shows "Copied". `nonce` re-arms the dismiss
  // timer and re-announces on a repeat copy even when the same row is copied.
  const [copied, setCopied] = useState<{
    taskId: number;
    nonce: number;
  } | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), COPIED_HINT_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  if (summary === null) return null;

  const results = summary.results;
  const succeeded = results.filter((r) => r.status === "succeeded").length;
  const cancelled = results.filter((r) => r.status === "cancelled").length;
  const failed = results.filter((r) => r.status === "failed").length;

  // Header subline: per-outcome counts, omitting zero categories.
  const sublineParts: string[] = [];
  if (succeeded) sublineParts.push(`${succeeded} succeeded`);
  if (cancelled) sublineParts.push(`${cancelled} cancelled`);
  if (failed) sublineParts.push(`${failed} failed`);
  const subline = sublineParts.join(" · ");

  // Proportion bar segments in a stable visual order, omitting empty ones. The
  // status-*-foreground tokens are already registered (used as text colors), so
  // the bg-* variants resolve.
  const segments = [
    { key: "succeeded", n: succeeded, bg: "bg-status-success-foreground" },
    { key: "cancelled", n: cancelled, bg: "bg-status-warning-foreground" },
    { key: "failed", n: failed, bg: "bg-status-danger-foreground" },
  ].filter((s) => s.n > 0);

  // Preserve each row's original job-order number before grouping reorders them.
  const entries = results.map((result, index) => ({ result, index }));
  const groups = GROUP_ORDER.map((outcome) => ({
    outcome,
    items: entries.filter((e) => e.result.status === outcome),
  })).filter((g) => g.items.length > 0);

  const handleCopy = (taskId: number, outputPath: string) =>
    runOrReportError(async () => {
      await copyText(outputPath);
      setCopied((prev) => ({ taskId, nonce: (prev?.nonce ?? 0) + 1 }));
    });

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
        {/* Sticky header: batch summary + the whole-job actions. Open folder is
            the primary next action; Clear is the quieter outline dismiss. */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-md border-b border-border bg-card px-4 py-3">
          <div>
            <div className="font-semibold text-foreground">
              {results.length} archives
            </div>
            {subline !== "" && (
              <div className="text-xs text-muted-foreground">{subline}</div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Guarded on outputDir so it never opens a null path. */}
            {outputDir !== null && (
              <Button
                variant="default"
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
              <Delete aria-hidden="true" />
              Clear
            </Button>
          </div>
        </div>

        {/* Proportion bar (decorative; counts are read out via the subline). */}
        <div
          aria-hidden="true"
          className="ledger-segment-bar flex h-1.5 overflow-hidden"
        >
          {segments.map((s) => (
            <div key={s.key} className={s.bg} style={{ flexGrow: s.n }} />
          ))}
        </div>

        {/* Grouped rows: one tbody per non-empty outcome, failures first. */}
        <table className="w-full text-left">
          {groups.map((group) => {
            const visual = statusVisual(group.outcome);
            return (
              <tbody key={group.outcome}>
                <tr>
                  <th
                    colSpan={4}
                    scope="rowgroup"
                    className={`px-4 py-1.5 text-left text-xs font-semibold ${visual.className}`}
                  >
                    <span aria-hidden="true">{visual.icon}</span> {visual.label}{" "}
                    · {group.items.length}
                  </th>
                </tr>
                {group.items.map(({ result, index }) => (
                  <LedgerRow
                    key={result.taskId}
                    index={index}
                    result={result}
                    source={basename(items[index]?.path ?? "")}
                    size={sizeForTask(result.taskId, progress)}
                    copiedNonce={
                      copied?.taskId === result.taskId ? copied.nonce : null
                    }
                    onCopy={handleCopy}
                  />
                ))}
              </tbody>
            );
          })}
        </table>
      </output>

      {/* Visually-hidden, polite announcement of a successful copy. Keyed by nonce
          so a repeat copy re-announces even though the text is unchanged. */}
      {copied !== null && (
        <output key={copied.nonce} aria-live="polite" className="sr-only">
          Path was copied
        </output>
      )}
    </>
  );
}
