import { afterEach, describe, expect, it, vi } from "vitest";

import { domColumnMeasurer } from "./column-measure";

// Build a detached-then-attached table the measurer can clone. The measurer
// reads layout via getBoundingClientRect, which jsdom reports as zero width, so
// tests that need a real measurement stub the cell rect explicitly.
function tableWith(html: string): HTMLTableElement {
  const table = document.createElement("table");
  table.innerHTML = html;
  document.body.appendChild(table);
  return table;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("domColumnMeasurer", () => {
  it("returns the widest measured cell width in the column, rounded up", () => {
    const table = tableWith(`
      <thead><tr><th>#</th><th>Source</th></tr></thead>
      <tbody>
        <tr><td>1</td><td>short</td></tr>
        <tr><td>2</td><td>a-much-longer-name</td></tr>
      </tbody>`);
    // Stand in for layout: width grows with the cell's text length.
    vi.spyOn(
      HTMLTableCellElement.prototype,
      "getBoundingClientRect",
    ).mockImplementation(function (this: HTMLTableCellElement) {
      return { width: (this.textContent ?? "").length * 7 } as DOMRect;
    });

    // Column 1 (Source): max of "Source"(6), "short"(5), "a-much-longer-name"(18)
    // = 18 * 7 = 126.
    expect(domColumnMeasurer.measure(table, 1)).toBe(126);
  });

  it("returns null when the column has no measurable width (no layout)", () => {
    // jsdom reports zero-width rects; a zero measurement means "unmeasurable" so
    // callers keep the current width instead of collapsing the column.
    const table = tableWith(`<tbody><tr><td>1</td><td>x</td></tr></tbody>`);
    expect(domColumnMeasurer.measure(table, 1)).toBeNull();
  });

  it("returns null when no cell exists at the column index", () => {
    const table = tableWith(`<tbody><tr><td>1</td></tr></tbody>`);
    expect(domColumnMeasurer.measure(table, 5)).toBeNull();
  });

  it("leaves no measuring artifacts in the document after measuring", () => {
    const table = tableWith(`<tbody><tr><td>1</td><td>x</td></tr></tbody>`);
    domColumnMeasurer.measure(table, 1);
    expect(document.querySelectorAll("[data-column-measure]").length).toBe(0);
  });
});
