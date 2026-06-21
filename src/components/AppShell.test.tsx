import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_RAIL_WIDTH, RAIL_WIDTH_STORAGE_KEY } from "@/lib/rail-width";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  beforeEach(() => {
    localStorage.clear();
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
