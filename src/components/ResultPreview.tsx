import { Folder, Package } from "lucide-react";

import { useChooseOutputDir } from "@/hooks/useChooseOutputDir";
import { selectFirstPreview, useJobStore } from "@/store/jobStore";

// Derive a representative folder name from an input archive path: the basename
// without its extension. Folder mode extracts each archive into a folder named
// after the archive, so this mirrors the first folder's name (input-derived, no
// backend naming logic).
function baseNameWithoutExt(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * The result-led hero of the OUTPUT rail. One card answers "where + what will I
 * get", folding the destination (with a Change action) and the landing preview
 * into a single block — replacing the old standalone Destination summary and the
 * separate hero path (and their duplicate directory line).
 *
 * State precedence: no destination -> empty/Required; else (zip) preview error
 * -> alert; else loading (firstPreview === null) -> placeholder; else ready.
 */
export function ResultPreview() {
  const outputDir = useJobStore((s) => s.draft.outputDir);
  const outputMode = useJobStore((s) => s.draft.outputMode);
  const items = useJobStore((s) => s.draft.items);
  const firstPreview = useJobStore(selectFirstPreview);
  const previewError = useJobStore((s) => s.previewError);
  const choose = useChooseOutputDir();

  const count = items.length;

  if (outputDir === null) {
    return (
      <div
        data-testid="result-preview"
        className="flex flex-col gap-2 rounded-xl border border-dashed border-border bg-muted/30 p-4"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Result preview
          </span>
          <span className="rounded-full bg-status-danger-subtle px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-status-danger-foreground">
            Required
          </span>
        </div>
        <div className="flex flex-col items-center gap-2 py-2 text-center">
          <p className="text-sm text-muted-foreground">
            Choose a destination to preview the result
          </p>
          <button
            type="button"
            onClick={() => void choose()}
            className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-accent"
          >
            Choose folder…
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="result-preview"
      className="flex flex-col gap-2 rounded-xl border border-border bg-primary/5 p-4"
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Result preview
        </span>
        <button
          type="button"
          onClick={() => void choose()}
          className="rounded-md border border-border px-2 py-0.5 text-xs font-medium hover:bg-accent"
        >
          Change…
        </button>
      </div>

      {outputMode === "folder" ? (
        <div className="flex items-center gap-2">
          <Folder aria-hidden="true" className="size-5 text-primary" />
          <span className="font-mono text-sm font-semibold text-foreground">
            {count > 0
              ? `${baseNameWithoutExt(items[0].path)}/`
              : "<archive name>/"}
          </span>
          {count > 0 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {count} {count === 1 ? "archive" : "archives"}
            </span>
          ) : null}
        </div>
      ) : previewError ? (
        <p role="alert" className="text-sm text-destructive">
          {previewError}
        </p>
      ) : (
        // Folder mode is handled above, so the trailing else is the zip ready/loading state.
        <div className="flex items-center gap-2">
          <Package aria-hidden="true" className="size-5 text-primary" />
          {firstPreview ? (
            <span className="font-mono text-sm font-semibold text-foreground">
              {firstPreview}
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              Preparing preview…
            </span>
          )}
          {count > 0 ? (
            <span className="ml-auto text-xs text-muted-foreground">
              {count} {count === 1 ? "file" : "files"}
            </span>
          ) : null}
        </div>
      )}

      <p
        className="truncate font-mono text-xs text-muted-foreground"
        title={outputDir}
      >
        {outputDir}
      </p>
    </div>
  );
}
