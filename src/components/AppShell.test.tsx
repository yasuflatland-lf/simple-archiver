import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { AppShell } from "./AppShell";

describe("AppShell", () => {
  function renderShell(banner?: ReactNode) {
    render(
      <AppShell
        toolbar={<div>TOOLBAR</div>}
        banner={banner}
        statusBar={<div>STATUS</div>}
      >
        <div>MAIN</div>
      </AppShell>,
    );
  }

  it("renders all slots in their landmark regions", () => {
    renderShell();
    expect(screen.getByRole("main").textContent).toContain("MAIN");
    expect(screen.getByRole("contentinfo").textContent).toContain("STATUS");
    expect(screen.getByText("TOOLBAR")).toBeTruthy();
  });

  it("renders no header/banner landmark", () => {
    // The header region was removed; the toolbar is now the topmost zone.
    renderShell();
    expect(screen.queryByRole("banner")).toBeNull();
  });

  it("makes only the main region scrollable", () => {
    renderShell();
    const main = screen.getByRole("main");
    expect(main.className).toContain("overflow-y-auto");
    expect(main.className).toContain("min-h-0");
  });

  it("composes from tokens, not raw colors", () => {
    renderShell();
    const main = screen.getByRole("main");
    const shell = main.parentElement as HTMLElement;
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
