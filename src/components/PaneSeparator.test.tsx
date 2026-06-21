import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PaneSeparator } from "./PaneSeparator";

function baseProps() {
  return {
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    "aria-label": "Resize output panel",
    onPointerDown: vi.fn(),
    onPointerMove: vi.fn(),
    onPointerUp: vi.fn(),
    onPointerCancel: vi.fn(),
    onLostPointerCapture: vi.fn(),
    onDoubleClick: vi.fn(),
  };
}

describe("PaneSeparator", () => {
  it("renders a labelled vertical structural separator", () => {
    render(<PaneSeparator isDragging={false} {...baseProps()} />);
    const separator = screen.getByRole("separator");
    expect(separator.getAttribute("aria-orientation")).toBe("vertical");
    expect(separator.getAttribute("aria-label")).toBe("Resize output panel");
  });

  it("carries no aria-value props (it is not an operable widget)", () => {
    render(<PaneSeparator isDragging={false} {...baseProps()} />);
    const separator = screen.getByRole("separator");
    expect(separator.hasAttribute("aria-valuenow")).toBe(false);
    expect(separator.hasAttribute("aria-valuemin")).toBe(false);
    expect(separator.hasAttribute("aria-valuemax")).toBe(false);
    expect(separator.hasAttribute("tabindex")).toBe(false);
  });

  it("shows the col-resize affordance", () => {
    render(<PaneSeparator isDragging={false} {...baseProps()} />);
    expect(screen.getByRole("separator").className).toContain(
      "cursor-col-resize",
    );
  });

  it("marks itself as dragging while a drag is in progress", () => {
    render(<PaneSeparator isDragging={true} {...baseProps()} />);
    expect(screen.getByRole("separator").getAttribute("data-dragging")).toBe(
      "true",
    );
  });

  it("is not marked as dragging at rest", () => {
    render(<PaneSeparator isDragging={false} {...baseProps()} />);
    expect(
      screen.getByRole("separator").getAttribute("data-dragging"),
    ).toBeNull();
  });

  it("forwards pointer-down and double-click to its handlers", () => {
    const props = baseProps();
    render(<PaneSeparator isDragging={false} {...props} />);
    const separator = screen.getByRole("separator");
    fireEvent.pointerDown(separator);
    fireEvent.doubleClick(separator);
    expect(props.onPointerDown).toHaveBeenCalledTimes(1);
    expect(props.onDoubleClick).toHaveBeenCalledTimes(1);
  });
});
