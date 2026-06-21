import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
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
});
