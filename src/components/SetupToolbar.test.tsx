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

  it("aligns settings in a grid that collapses to one column on narrow windows", () => {
    const { container } = render(<SetupToolbar />);
    const grid = container.querySelector("div.grid") as HTMLElement;
    expect(grid).not.toBeNull();
    expect(grid.className).toContain("md:grid-cols-2");
  });

  it("lets the action bar wrap so a narrow window does not clip it", () => {
    const { container } = render(<SetupToolbar />);
    expect(container.querySelector(".flex-wrap")).not.toBeNull();
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
