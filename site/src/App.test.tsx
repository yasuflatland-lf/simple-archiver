import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { App } from "@/App";

describe("App landing page", () => {
  it("renders the primary anchor navigation", () => {
    render(<App />);
    expect(screen.getByRole("link", { name: "Overview" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Workflow" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Install" })).toBeTruthy();
  });

  it("renders both hero screenshots by their alt text", () => {
    render(<App />);
    expect(
      screen.getByAltText("Simple Archiver folders mode screenshot"),
    ).toBeTruthy();
    expect(screen.getByAltText(/zip files mode/i)).toBeTruthy();
  });

  it("renders the usage movie with its accessible label", () => {
    render(<App />);
    expect(
      screen.getByLabelText("Simple Archiver basic usage movie"),
    ).toBeTruthy();
  });

  it("points both Latest release CTAs at the GitHub releases page", () => {
    render(<App />);
    const links = screen.getAllByRole("link", { name: "Latest release" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link.getAttribute("href")).toBe(
        "https://github.com/yasuflatland-lf/simple-archiver/releases",
      );
    }
  });
});
