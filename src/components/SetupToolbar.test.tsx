import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { SetupToolbar } from "./SetupToolbar";

// NamingRuleForm invokes the backend on mount; mock the core + dialog plugins.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("preview.zip")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

describe("SetupToolbar", () => {
  beforeEach(() => {
    resetJobStore();
    // Stop the NamingRuleForm mount debounce from mutating the draft (mirrors
    // App.test.tsx): replace setNamingRule with a no-op spy.
    useJobStore.setState({ setNamingRule: vi.fn() });
  });

  it("renders the add-source buttons", () => {
    render(<SetupToolbar />);
    expect(screen.getByRole("button", { name: /add files/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeTruthy();
  });

  it("renders the naming template control", () => {
    render(<SetupToolbar />);
    expect(screen.getByText(/naming template/i)).toBeTruthy();
  });

  it("renders the output directory control", () => {
    render(<SetupToolbar />);
    expect(screen.getByText(/output directory/i)).toBeTruthy();
  });

  it("renders the Run control", () => {
    render(<SetupToolbar />);
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
  });

  it("wraps controls so a narrow window does not clip them", () => {
    const { container } = render(<SetupToolbar />);
    expect((container.firstChild as HTMLElement).className).toContain(
      "flex-wrap",
    );
  });
});
