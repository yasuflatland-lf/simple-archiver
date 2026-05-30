import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubMatchMedia } from "@/test/stub-match-media";
import { ThemeProvider, useTheme } from "./theme-provider";

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button type="button" onClick={() => setTheme("dark")}>
        to-dark
      </button>
      <button type="button" onClick={() => setTheme("light")}>
        to-light
      </button>
    </div>
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

describe("ThemeProvider", () => {
  it("defaults to system and applies the OS dark preference", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("adds .dark and persists when switched to dark", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole("button", { name: "to-dark" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("simple-archiver-theme")).toBe("dark");
  });

  it("removes .dark when switched to light", async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider defaultTheme="dark">
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    await user.click(screen.getByRole("button", { name: "to-light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("restores the persisted theme on remount", () => {
    localStorage.setItem("simple-archiver-theme", "dark");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("falls back to the default when the persisted value is not a valid theme", () => {
    localStorage.setItem("simple-archiver-theme", "auto");
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("theme").textContent).toBe("system");
    expect(document.documentElement.classList.contains("auto")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("re-applies the resolved class when the OS preference changes in system mode", () => {
    const handlers: Array<() => void> = [];
    const media = {
      matches: false,
      media: "(prefers-color-scheme: dark)",
      onchange: null,
      addEventListener: vi.fn((_event: string, cb: () => void) => {
        handlers.push(cb);
      }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal("matchMedia", vi.fn().mockReturnValue(media));
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // Simulate the OS switching to dark while the user stays on "system".
    media.matches = true;
    for (const cb of handlers) cb();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});
