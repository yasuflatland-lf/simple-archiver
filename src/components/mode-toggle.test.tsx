import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModeToggle } from "./mode-toggle";
import { ThemeProvider } from "./theme-provider";

function stubMatchMedia(matches: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockReturnValue({
      matches,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ModeToggle", () => {
  it("renders an accessible theme toggle button", () => {
    render(
      <ThemeProvider>
        <ModeToggle />
      </ThemeProvider>,
    );
    expect(screen.getByRole("button", { name: /theme/i })).toBeTruthy();
  });

  it("switches the document to dark when cycled from light", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="light">
        <ModeToggle />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: /theme/i }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("cycles dark → system → light across clicks", async () => {
    const user = userEvent.setup();
    const btn = () => screen.getByRole("button", { name: /theme/i });
    render(
      <ThemeProvider defaultTheme="dark">
        <ModeToggle />
      </ThemeProvider>,
    );
    // dark → system
    await user.click(btn());
    expect(btn().getAttribute("aria-label")).toContain("current: system");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    // system → light (wrap-around)
    await user.click(btn());
    expect(btn().getAttribute("aria-label")).toContain("current: light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
