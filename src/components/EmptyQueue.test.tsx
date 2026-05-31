import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore } from "@/store/jobStore";

import { EmptyQueue } from "./EmptyQueue";

// AddSourceButtons calls the dialog plugin on click; mock it so the import is
// side-effect-free in jsdom.
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("EmptyQueue", () => {
  beforeEach(() => resetJobStore());

  it("prompts for drag-and-drop of files or folders", () => {
    render(<EmptyQueue />);
    expect(screen.getByText(/drag .* drop files or folders/i)).toBeTruthy();
  });

  it("offers the two browse fallbacks", () => {
    render(<EmptyQueue />);
    expect(screen.getByRole("button", { name: /add files/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeTruthy();
  });

  it("styles from tokens (dashed border via border-border)", () => {
    render(<EmptyQueue />);
    const zone = screen.getByTestId("empty-queue");
    expect(zone.className).toContain("border-border");
    expect(zone.className).toContain("text-muted-foreground");
  });
});
