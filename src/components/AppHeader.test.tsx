import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppHeader } from "./AppHeader";

describe("AppHeader", () => {
  it("renders the app title", () => {
    render(<AppHeader />);
    expect(screen.getByText("simple-archiver")).toBeTruthy();
  });

  it("titles via the heading token, not a raw color", () => {
    render(<AppHeader />);
    const title = screen.getByText("simple-archiver");
    expect(title.className).toContain("text-heading");
  });

  it("renders the app logo image, not an emoji placeholder", () => {
    const { container } = render(<AppHeader />);
    const logo = container.querySelector("img");
    expect(logo?.getAttribute("src")).toBe("/logo.png");
  });

  it("renders no theme toggle button", () => {
    // The app follows the OS color scheme; there is no manual toggle.
    render(<AppHeader />);
    expect(screen.queryByRole("button", { name: /theme/i })).toBeNull();
  });
});
