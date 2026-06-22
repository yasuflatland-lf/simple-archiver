import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_RAIL_WIDTH } from "@/lib/rail-width";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { LeftRail } from "./LeftRail";

// NamingRuleForm invokes the backend on mount; mock the core + dialog plugins so
// the rail renders without a native Tauri runtime.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve("preview.zip")),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

// Minimal DraftItemDto stub — only `path` and `kind` are required by the type.
const ITEM = { path: "/a.rar", kind: "rar" as const };

beforeEach(() => {
  resetJobStore();
  // Stop the NamingRuleForm/StartNumberForm mount debounce from mutating the
  // draft (mirrors App.test.tsx): replace the actions with no-op spies.
  useJobStore.setState({ setNamingRule: vi.fn(), setStartNumber: vi.fn() });
});

function setMode(outputMode: "zip" | "folder", outputDir: string | null) {
  useJobStore.setState({
    draft: {
      items: [ITEM],
      namingTemplate: null,
      startNumber: 1,
      outputDir,
      outputMode,
      conflictPolicy: "autoRename",
    },
    setNamingRule: vi.fn(),
    setStartNumber: vi.fn(),
  });
}

describe("LeftRail", () => {
  it("is an accessible landmark labelled for output settings", () => {
    render(<LeftRail />);
    // An <aside> is a "complementary" landmark; the aria-label names it so AT
    // can jump to the output-settings rail.
    const region = screen.getByRole("complementary", {
      name: /output settings/i,
    });
    expect(region).toBeTruthy();
  });

  it("shows the collapsed Destination summary with a Change control", () => {
    render(<LeftRail />);
    expect(screen.getByText("Destination")).toBeTruthy();
    expect(screen.getByRole("button", { name: /change/i })).toBeTruthy();
  });

  it("shows the (not set) + Required empty state when no destination is set", () => {
    render(<LeftRail />);
    expect(screen.getByText("(not set)")).toBeTruthy();
    expect(screen.getByText("Required")).toBeTruthy();
  });

  it("renders Naming and Start # in zip mode", () => {
    setMode("zip", "/out");
    render(<LeftRail />);
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByLabelText("Start #")).toBeTruthy();
    // The folder-mode collision policy must be absent in zip mode.
    expect(
      screen.queryByRole("radiogroup", { name: /a folder already exists/i }),
    ).toBeNull();
  });

  it("renders the conflict policy in folder mode and hides Naming/Start #", () => {
    setMode("folder", "/out");
    render(<LeftRail />);
    expect(
      screen.getByRole("radiogroup", { name: /a folder already exists/i }),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
    expect(screen.queryByLabelText("Start #")).toBeNull();
  });

  it("places the If exists control above the Destination section in folder mode", () => {
    setMode("folder", "/out");
    render(<LeftRail />);
    const conflictPolicy = screen.getByRole("radiogroup", {
      name: /a folder already exists/i,
    });
    const destination = screen.getByText("Destination");
    // The conflict policy must precede the Destination block in document order.
    expect(
      conflictPolicy.compareDocumentPosition(destination) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the Output as mode toggle", () => {
    render(<LeftRail />);
    expect(screen.getByRole("radiogroup", { name: /output as/i })).toBeTruthy();
  });

  it("renders the Run control inside the rail", () => {
    render(<LeftRail />);
    expect(screen.getByRole("button", { name: /^run$/i })).toBeTruthy();
  });

  it("shows the Cancel control while a job runs", () => {
    setMode("zip", "/out");
    useJobStore.setState({ running: true });
    render(<LeftRail />);
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^run$/i })).toBeNull();
  });

  it("scrolls horizontally instead of clipping the controls when the pane is narrow", () => {
    render(<LeftRail />);
    const region = screen.getByRole("complementary", {
      name: /output settings/i,
    });
    // The rail scrolls on both axes: a pane narrower than the controls' design
    // width shows a horizontal scrollbar rather than clipping/compressing them.
    // `overflow-y-auto` would clip horizontal overflow, so the class must be the
    // both-axes `overflow-auto`.
    expect(region.className.split(/\s+/)).toContain("overflow-auto");
  });

  it("keeps the controls at least the default rail width so a narrow pane scrolls", () => {
    render(<LeftRail />);
    // The controls live in a content wrapper that never collapses below the
    // default rail width; when the pane is dragged narrower, that wrapper
    // overflows and the rail scrolls horizontally instead of compressing.
    const content = screen.getByTestId("rail-content");
    expect(content.style.minWidth).toBe(`${DEFAULT_RAIL_WIDTH}px`);
  });

  it("keeps Run accessibly disabled with a describedby reason when not ready", () => {
    // No items + no destination → Run is unavailable.
    render(<LeftRail />);
    const run = screen.getByRole("button", { name: /^run$/i });
    expect(run.getAttribute("aria-disabled")).toBe("true");
    expect(run.getAttribute("aria-describedby")).toBe("run-disabled-reason");
  });
});
