import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { ThemeProvider } from "@/components/theme-provider";
import { stubMatchMedia } from "@/test/stub-match-media";

beforeEach(() => {
  stubMatchMedia(false);
});

import { AppHeader } from "./AppHeader";

// ModeToggle reads the theme context, so wrap in the provider.
function renderHeader() {
  render(
    <ThemeProvider>
      <AppHeader />
    </ThemeProvider>,
  );
}

describe("AppHeader", () => {
  it("renders the app title", () => {
    renderHeader();
    expect(screen.getByText("simple-archiver")).toBeTruthy();
  });

  it("renders the theme toggle", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: /toggle theme/i })).toBeTruthy();
  });

  it("titles via the heading token, not a raw color", () => {
    renderHeader();
    const title = screen.getByText("simple-archiver");
    expect(title.className).toContain("text-heading");
  });
});
