import { open } from "@tauri-apps/plugin-dialog";
import { render, screen } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { previewOutputName } from "@/lib/archive";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { OutputSettings } from "./OutputSettings";

// The directory picker dialog is mocked so tests run without a native runtime.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// previewOutputName is owned by the store now; mock the wrapper only so the
// child NamingRuleForm's debounced store push cannot reach a real backend.
// OutputSettings itself no longer calls it: it reads the store's firstPreview.
vi.mock("@/lib/archive", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/archive")>();
  return { ...actual, previewOutputName: vi.fn() };
});

describe("OutputSettings", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(open).mockReset();
    vi.mocked(previewOutputName).mockReset();
    vi.mocked(previewOutputName).mockResolvedValue("photo_001.zip");
    // Replace setNamingRule with a spy so NamingRuleForm's debounced store push
    // does not call the real action (which would invoke the backend).
    useJobStore.setState({ setNamingRule: vi.fn() });
  });

  it("renders the OUTPUT group heading and Destination/Name child headings", () => {
    render(<OutputSettings />);

    expect(screen.getByText("OUTPUT")).toBeDefined();
    expect(screen.getByText("Destination")).toBeDefined();
    expect(screen.getByText("Name")).toBeDefined();
  });

  it("shows the filename only and a hint when no destination is selected", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: null,
        outputMode: "zip",
      },
      firstPreview: "photo_001.zip",
    });
    render(<OutputSettings />);

    // The bare filename appears from the store's firstPreview.
    expect(screen.getByText("photo_001.zip")).toBeDefined();
    // The hint nudges the user to pick a destination for the full path.
    expect(
      screen.getByText("Select a destination to preview the full path."),
    ).toBeDefined();
  });

  it("shows the joined full path once a destination is selected", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: "photo_001.zip",
    });
    render(<OutputSettings />);

    expect(screen.getByText("~/Archives/photo_001.zip")).toBeDefined();
    // The destination-required hint must be gone once a destination exists.
    expect(
      screen.queryByText("Select a destination to preview the full path."),
    ).toBeNull();
  });

  it("surfaces a template error from the store preview as an alert", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: null,
        outputMode: "zip",
      },
      firstPreview: "",
      previewError: "invalid naming template: stray or malformed brace",
    });
    render(<OutputSettings />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);
  });

  it("clears the alert and restores the preview after the store recovers", () => {
    // Start in an error state so the alert fires.
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: "",
      previewError: "invalid naming template: stray or malformed brace",
    });
    render(<OutputSettings />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);

    // The store recovers: a good template resolves to a preview, error cleared.
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, namingTemplate: "photo_{n:03}" },
        firstPreview: "photo_001.zip",
        previewError: null,
      }));
    });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("~/Archives/photo_001.zip")).toBeDefined();
  });

  // Pinning regression (issue #78 step 1): OutputSettings shows the store's
  // first preview joined with the directory, and re-renders when it changes.
  it("renders the store firstPreview joined with the directory and tracks changes", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: "photo_001.zip",
    });
    render(<OutputSettings />);

    expect(screen.getByText("~/Archives/photo_001.zip")).toBeDefined();

    // When the store's firstPreview changes, the rendered hero follows.
    act(() => {
      useJobStore.setState({ firstPreview: "photo_999.zip" });
    });
    expect(screen.getByText("~/Archives/photo_999.zip")).toBeDefined();
    expect(screen.queryByText("~/Archives/photo_001.zip")).toBeNull();
  });

  // Regression: when the store preview errors and outputDir is set, the
  // component must not render the directory path alone (e.g. "~/Archives/")
  // in the full-path preview area. The alert itself is still shown; only
  // the isolated directory must be absent from the monospace preview span.
  it("does not render directory-only path after a preview error with outputDir set", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: "",
      previewError: "invalid naming template: stray or malformed brace",
    });
    render(<OutputSettings />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);

    // The full-path preview span (font-mono) must not exist in the DOM.
    expect(screen.queryByText("~/Archives/")).toBeNull();
  });

  // Regression: while the preview is still loading (firstPreview === null), the
  // hero must render neither a full path nor a bare filename, so the directory
  // is never shown in isolation during the recompute window.
  it("does not render the hero path while the preview is still loading", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: null,
    });
    render(<OutputSettings />);

    expect(screen.queryByText("~/Archives/photo_001.zip")).toBeNull();
    expect(screen.queryByText("photo_001.zip")).toBeNull();
  });

  // Regression: when the preview errors and no destination is set, the hero
  // must not render the filename-only line; only the alert and the
  // destination-required hint remain.
  it("does not render the filename-only hero after a preview error with no destination", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: null,
        outputMode: "zip",
      },
      firstPreview: "",
      previewError: "invalid naming template: stray or malformed brace",
    });
    render(<OutputSettings />);

    const alert = screen.getByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);

    // The hint renders independently of the alert: both must appear together
    // when outputDir is null and the preview has errored.
    expect(
      screen.getByText("Select a destination to preview the full path."),
    ).toBeDefined();

    expect(screen.queryByText("photo_001.zip")).toBeNull();
  });

  // The hero must show the full path with a leading arrow once a destination is
  // set; the arrow is absent in the filename-only (no-destination) state.
  it("renders the hero arrow only when a destination joins the filename", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/Archives",
        outputMode: "zip",
      },
      firstPreview: "photo_001.zip",
    });
    render(<OutputSettings />);

    expect(screen.getByText("~/Archives/photo_001.zip")).toBeDefined();
    // The ArrowRight icon carries data-testid="hero-path-arrow"; this assertion
    // is specific to the arrow icon (not any arbitrary SVG in the tree).
    expect(screen.getByTestId("hero-path-arrow")).toBeDefined();
  });

  // Complementary negative: no destination → filename-only state → arrow absent.
  // If the conditional rendering of ArrowRight were accidentally removed this
  // test would still pass, but if the condition were inverted (always rendered)
  // this test would fail. It pairs with the positive test above to guard both
  // directions of the conditional.
  it("does not render the hero arrow when no destination is selected", () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: null,
        outputMode: "zip",
      },
      firstPreview: "photo_001.zip",
    });
    render(<OutputSettings />);

    expect(screen.getByText("photo_001.zip")).toBeDefined();
    // The arrow must be absent in the filename-only state.
    expect(screen.queryByTestId("hero-path-arrow")).toBeNull();
  });
});
