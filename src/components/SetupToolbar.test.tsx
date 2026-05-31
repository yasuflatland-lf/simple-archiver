import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { SetupToolbar } from "./SetupToolbar";

// NamingRuleForm invokes the backend on mount; mock the core + dialog plugins.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("preview.zip")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// Minimal DraftItemDto stub – only `path` and `kind` are required by the type.
const ITEM = { path: "/a.rar", kind: "rar" as const };

beforeEach(() => {
  resetJobStore();
  // Stop the NamingRuleForm mount debounce from mutating the draft (mirrors
  // App.test.tsx): replace setNamingRule with a no-op spy.
  useJobStore.setState({ setNamingRule: vi.fn() });
});

function withItems() {
  useJobStore.setState({
    draft: { items: [ITEM], namingTemplate: null, outputDir: null },
    setNamingRule: vi.fn(),
  });
}

describe("SetupToolbar", () => {
  it("renders the Name control", () => {
    render(<SetupToolbar />);
    expect(screen.getByText("Name")).toBeTruthy();
  });

  it("renders the Destination control", () => {
    render(<SetupToolbar />);
    expect(screen.getByText("Destination")).toBeTruthy();
  });

  it("renders the Run control", () => {
    render(<SetupToolbar />);
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
  });

  it("hides the browse buttons while the queue is empty (drop zone owns them)", () => {
    render(<SetupToolbar />);
    expect(screen.queryByRole("button", { name: /add files/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /add folder/i })).toBeNull();
  });

  it("shows the browse buttons once the queue has items", () => {
    withItems();
    render(<SetupToolbar />);
    expect(screen.getByRole("button", { name: /add files/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /add folder/i })).toBeTruthy();
  });

  it("aligns the OUTPUT editing rows in a single shared label/control grid", () => {
    const { container } = render(<SetupToolbar />);
    const grid = container.querySelector("div.grid") as HTMLElement;
    expect(grid).not.toBeNull();
    // Design "B′" replaced the symmetric responsive 2-column grid with one
    // shared grid: a fixed label column, a flexible control column, and a
    // trailing action column for the Choose button.
    expect(grid.className).toContain(
      "grid-cols-[max-content_minmax(0,1fr)_auto]",
    );
  });

  it("lets the action bar wrap so a narrow window does not clip it", () => {
    const { container } = render(<SetupToolbar />);
    expect(container.querySelector(".flex-wrap")).not.toBeNull();
  });

  it("keeps the OUTPUT content and action bar in one non-scrolling zone", () => {
    // The whole setup zone must stay fully visible when the viewport shrinks
    // vertically — nothing here may be hidden behind an internal scroll. So the
    // zone itself owns no height-capped overflow region: the readiness chip and
    // full-path preview (OUTPUT) and the Run/Cancel action bar all live in the
    // same non-scrolling column. AppShell's queue absorbs vertical shrink.
    const { container } = render(<SetupToolbar />);
    expect(container.querySelector(".overflow-y-auto")).toBeNull();
    expect(container.querySelector(".overflow-y-scroll")).toBeNull();
    expect(container.querySelector('[class*="max-h-"]')).toBeNull();
  });

  it("renders OUTPUT readiness and the action bar together", () => {
    // The OUTPUT readiness chip (a vertical-shrink casualty of the old internal
    // scroll) and the Run control share the setup zone and are present at once.
    render(<SetupToolbar />);
    expect(screen.getByText("Add files")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
  });

  it("hides the browse buttons again after all items are removed", () => {
    withItems();
    const { rerender } = render(<SetupToolbar />);
    expect(screen.getByRole("button", { name: /add files/i })).toBeTruthy();
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: null },
      setNamingRule: vi.fn(),
    });
    rerender(<SetupToolbar />);
    expect(screen.queryByRole("button", { name: /add files/i })).toBeNull();
  });
});
