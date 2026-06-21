// ---------------------------------------------------------------------------
// Queue table column model
// ---------------------------------------------------------------------------
//
// Single source of truth for the queue table's columns: their order, header
// labels, and resize bounds. `TaskList` renders the header (and the matching
// `<colgroup>`) from this list, and `useColumnResize` reads the bounds from it.
// `TaskRow` emits its `<td>` cells in the same order, so the column widths set
// here drive the body cells too under `table-layout: fixed`.

/** Stable identifiers for the queue table's columns, in render order. */
export type TaskColumnKey =
  | "index"
  | "kind"
  | "source"
  | "output"
  | "status"
  | "actions";

export interface TaskColumnDef {
  /** Stable key used for widths, handles, and the `<col>`/`<td>` ordering. */
  key: TaskColumnKey;
  /** Header text shown in the `<th>`. */
  label: string;
  /** Initial width in px (also the double-click reset target). */
  defaultWidth: number;
  /** Smallest width a drag may shrink the column to, in px. */
  minWidth: number;
  /** Whether the column carries a drag-to-resize handle on its right edge. */
  resizable: boolean;
}

/** Largest width a drag may grow any column to, in px — keeps the table sane. */
export const MAX_COLUMN_WIDTH = 800;

/**
 * The queue table columns in render order. `#` and `Actions` are fixed-width
 * (no handle); the four content columns between them are resizable. Defaults sum
 * to a comfortable table width that fills a typical canvas without forcing a
 * horizontal scroll.
 */
export const TASK_COLUMNS: TaskColumnDef[] = [
  {
    key: "index",
    label: "#",
    defaultWidth: 48,
    minWidth: 48,
    resizable: false,
  },
  {
    key: "kind",
    label: "Kind",
    defaultWidth: 88,
    minWidth: 64,
    resizable: true,
  },
  {
    key: "source",
    label: "Source",
    defaultWidth: 360,
    minWidth: 120,
    resizable: true,
  },
  {
    key: "output",
    label: "Output",
    defaultWidth: 200,
    minWidth: 120,
    resizable: true,
  },
  {
    key: "status",
    label: "Status",
    defaultWidth: 176,
    minWidth: 120,
    resizable: true,
  },
  {
    key: "actions",
    label: "Actions",
    defaultWidth: 150,
    minWidth: 150,
    resizable: false,
  },
];

/** Lookup by key — avoids repeated `.find()` and non-null assertions. */
export const COLUMN_BY_KEY: Record<TaskColumnKey, TaskColumnDef> =
  Object.fromEntries(TASK_COLUMNS.map((c) => [c.key, c])) as Record<
    TaskColumnKey,
    TaskColumnDef
  >;

/**
 * Clamp a candidate width to the column's [minWidth, MAX_COLUMN_WIDTH] range and
 * round it to a whole pixel. A non-finite input (NaN) falls back to the column
 * default. Mirrors the validate-before-use shape of {@link ../lib/rail-width}.
 */
export function clampColumnWidth(def: TaskColumnDef, width: number): number {
  if (Number.isNaN(width)) return def.defaultWidth;
  return Math.min(MAX_COLUMN_WIDTH, Math.max(def.minWidth, Math.round(width)));
}
