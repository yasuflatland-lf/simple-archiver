import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RAIL_WIDTH, RAIL_WIDTH_STORAGE_KEY } from "@/lib/rail-width";

import { AppShell } from "./AppShell";

/** Override an element's measured width so the canvas-min clamp can be tested. */
function mockWidth(element: Element, width: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    width,
  } as DOMRect);
}

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function renderShell(banner?: ReactNode) {
    render(
      <AppShell
        rail={<div>RAIL</div>}
        banner={banner}
        statusBar={<div>STATUS</div>}
      >
        <div>CANVAS</div>
      </AppShell>,
    );
  }

  it("renders the rail, canvas, and footer slots", () => {
    renderShell();
    expect(screen.getByText("RAIL")).toBeTruthy();
    expect(screen.getByText("CANVAS")).toBeTruthy();
    expect(screen.getByRole("contentinfo").textContent).toContain("STATUS");
  });

  it("renders no header/banner landmark", () => {
    // The header region was removed; the body (rail + canvas) is the topmost
    // content zone.
    renderShell();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("lays the body out as a flex row of rail then canvas", () => {
    renderShell();
    const body = screen.getByTestId("app-body");
    expect(body.className).toContain("flex");
    expect(body.className).toContain("flex-row");
    expect(body.className).toContain("min-h-0");
    // The rail comes before the canvas in the DOM order.
    const railIndex = body.innerHTML.indexOf("RAIL");
    const canvasIndex = body.innerHTML.indexOf("CANVAS");
    expect(railIndex).toBeGreaterThanOrEqual(0);
    expect(railIndex).toBeLessThan(canvasIndex);
  });

  it("composes from tokens, not raw colors", () => {
    renderShell();
    const shell = screen.getByTestId("app-shell");
    expect(shell.className).toContain("bg-background");
    expect(shell.className).toContain("text-foreground");
  });

  it("omits the banner region when no banner is provided", () => {
    renderShell();
    expect(screen.queryByTestId("app-banner")).toBeNull();
  });

  it("renders the banner region when a banner is provided", () => {
    renderShell(<div>OOPS</div>);
    expect(screen.getByTestId("app-banner").textContent).toContain("OOPS");
  });

  it("renders a draggable separator between the rail and the canvas", () => {
    renderShell();
    const body = screen.getByTestId("app-body");
    const separator = screen.getByRole("separator");
    expect(body.contains(separator)).toBe(true);
    // DOM order: rail pane, then separator, then canvas.
    const railIndex = body.innerHTML.indexOf("RAIL");
    const separatorIndex = body.innerHTML.indexOf("separator");
    const canvasIndex = body.innerHTML.indexOf("CANVAS");
    expect(railIndex).toBeLessThan(separatorIndex);
    expect(separatorIndex).toBeLessThan(canvasIndex);
  });

  it("sizes the rail pane to the default width", () => {
    renderShell();
    expect(screen.getByTestId("rail-pane").style.width).toBe(
      `${DEFAULT_RAIL_WIDTH}px`,
    );
  });

  it("restores the persisted rail width on mount", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "440");
    renderShell();
    expect(screen.getByTestId("rail-pane").style.width).toBe("440px");
  });

  it("widens the rail pane as the separator is dragged right", () => {
    renderShell();
    const separator = screen.getByRole("separator");
    fireEvent.pointerDown(separator, { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(separator, { clientX: 180, buttons: 1 });
    expect(screen.getByTestId("rail-pane").style.width).toBe(
      `${DEFAULT_RAIL_WIDTH + 80}px`,
    );
  });

  it("lets the separator drag the rail past the former fixed cap", () => {
    // Regression: the rail used to stop at 560px. With no measured container it
    // now follows the pointer to the right unbounded.
    renderShell();
    const separator = screen.getByRole("separator");
    fireEvent.pointerDown(separator, { clientX: 100, buttons: 1 });
    fireEvent.pointerMove(separator, { clientX: 700, buttons: 1 });
    expect(screen.getByTestId("rail-pane").style.width).toBe(
      `${DEFAULT_RAIL_WIDTH + 600}px`,
    );
  });

  it("stops the rail so the canvas keeps its minimum width", () => {
    renderShell();
    const body = screen.getByTestId("app-body");
    const separator = screen.getByRole("separator");
    mockWidth(body, 1000);
    mockWidth(separator, 6);
    fireEvent.pointerDown(separator, { clientX: 0, buttons: 1 });
    fireEvent.pointerMove(separator, { clientX: 5000, buttons: 1 });
    // 1000 container - 6 separator - 360 canvas-min = 634px.
    expect(screen.getByTestId("rail-pane").style.width).toBe("634px");
  });

  it("re-clamps the rail when the window shrinks below its width", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "900");
    renderShell();
    // Restored at its persisted width while the shell is still unmeasured.
    expect(screen.getByTestId("rail-pane").style.width).toBe("900px");
    mockWidth(screen.getByTestId("app-body"), 700);
    mockWidth(screen.getByRole("separator"), 6);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    // 700 - 6 - 360 = 334px.
    expect(screen.getByTestId("rail-pane").style.width).toBe("334px");
  });

  it("resets the rail width on double-clicking the separator", () => {
    localStorage.setItem(RAIL_WIDTH_STORAGE_KEY, "500");
    renderShell();
    expect(screen.getByTestId("rail-pane").style.width).toBe("500px");
    fireEvent.doubleClick(screen.getByRole("separator"));
    expect(screen.getByTestId("rail-pane").style.width).toBe(
      `${DEFAULT_RAIL_WIDTH}px`,
    );
  });
});
