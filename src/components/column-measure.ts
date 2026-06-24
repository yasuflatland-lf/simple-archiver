// ---------------------------------------------------------------------------
// Queue table column content measurement (port + DOM implementation)
// ---------------------------------------------------------------------------
//
// "Fit a column to its content" needs the intrinsic width of a column's widest
// cell, independent of the column's current fixed width — otherwise a column can
// never shrink below where it already sits. This port isolates that measurement
// so the sizing logic in `useColumnResize` can be unit-tested with a fake, while
// the real measurement happens only in a browser with layout.

/** Marker attribute on the off-screen measuring clone, for leak detection/cleanup. */
const MEASURE_MARKER = "data-column-measure";

export interface ColumnContentMeasurer {
  /**
   * Intrinsic content width (px) of the column at `columnIndex`, taken as the
   * widest single-line cell in that column across the header and body. Returns
   * `null` when unmeasurable (no layout, e.g. jsdom, or no cell at that index) so
   * callers keep the current width rather than collapsing the column.
   */
  measure(table: HTMLTableElement, columnIndex: number): number | null;
}

/**
 * Production measurer. Clones the table off-screen so measuring never disturbs
 * the live, React-controlled DOM, switches the clone to auto layout with cleared
 * column widths and non-wrapping cells (so each column takes its single-line
 * intrinsic width), reads the widest cell in the target column, and removes the
 * clone. The clone keeps the originals' class names, so global utility styles
 * (font, padding) resolve and the measurement matches the rendered cells.
 */
export const domColumnMeasurer: ColumnContentMeasurer = {
  measure(table, columnIndex) {
    const body = table.ownerDocument?.body;
    if (!body) return null;

    const clone = table.cloneNode(true) as HTMLTableElement;
    clone.setAttribute(MEASURE_MARKER, "");
    clone.style.tableLayout = "auto";
    clone.style.width = "auto";
    clone.style.position = "absolute";
    clone.style.left = "-99999px";
    clone.style.top = "0";
    clone.style.visibility = "hidden";
    clone.style.pointerEvents = "none";
    // Cleared <col> widths let columns shrink below their fixed width; nowrap
    // cells make each column size to its single-line content.
    for (const col of clone.querySelectorAll("col")) {
      (col as HTMLElement).style.width = "auto";
    }
    for (const cell of clone.querySelectorAll<HTMLElement>("th, td")) {
      cell.style.whiteSpace = "nowrap";
    }

    body.appendChild(clone);
    try {
      let max = 0;
      for (const row of clone.rows) {
        const cell = row.cells[columnIndex];
        if (cell === undefined) continue;
        const width = cell.getBoundingClientRect().width;
        if (width > max) max = width;
      }
      return max > 0 ? Math.ceil(max) : null;
    } finally {
      body.removeChild(clone);
    }
  },
};
