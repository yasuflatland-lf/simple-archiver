import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubMatchMedia } from "@/test/stub-match-media";

import { ThemeProvider } from "./theme-provider";

beforeEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove("light", "dark");
  stubMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ThemeProvider", () => {
  it("applies the OS dark preference to <html>", () => {
    stubMatchMedia(true);
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("applies the OS light preference to <html>", () => {
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("ignores any previously persisted theme and follows the OS", () => {
    // A stale choice from an older app version must not override the OS.
    localStorage.setItem("simple-archiver-theme", "dark");
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("removes a stale class before applying the resolved one", () => {
    document.documentElement.classList.add("dark");
    stubMatchMedia(false);
    render(
      <ThemeProvider>
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("re-applies the resolved class when the OS preference changes", () => {
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
        <div />
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains("light")).toBe(true);
    // The OS switches to dark; the app must follow without any user action.
    media.matches = true;
    for (const cb of handlers) cb();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });
});
