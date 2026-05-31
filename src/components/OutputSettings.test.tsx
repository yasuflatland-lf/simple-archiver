import { open } from "@tauri-apps/plugin-dialog";
import { render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_TEMPLATE } from "@/components/NamingRuleForm";
import { previewOutputName } from "@/lib/archive";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { OutputSettings } from "./OutputSettings";

// The directory picker dialog is mocked so tests run without a native runtime.
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

// The preview filename is owned by the backend; mock the wrapper so the
// full-path preview is deterministic without a Tauri runtime.
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

  it("shows the filename only and a hint when no destination is selected", async () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: "photo_{n:03}", outputDir: null },
    });
    render(<OutputSettings />);

    // The bare filename appears once the debounced preview resolves.
    await screen.findByText("photo_001.zip");
    // The hint nudges the user to pick a destination for the full path.
    expect(
      screen.getByText("Select a destination to preview the full path."),
    ).toBeDefined();
  });

  it("shows the joined full path once a destination is selected", async () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/Archives",
      },
    });
    render(<OutputSettings />);

    await screen.findByText("~/Archives/photo_001.zip");
    // The destination-required hint must be gone once a destination exists.
    expect(
      screen.queryByText("Select a destination to preview the full path."),
    ).toBeNull();
  });

  it("surfaces a template error from the preview as an alert", async () => {
    vi.mocked(previewOutputName).mockRejectedValue(
      "invalid naming template: stray or malformed brace",
    );
    useJobStore.setState({
      draft: { items: [], namingTemplate: "photo_{n", outputDir: null },
    });
    render(<OutputSettings />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);
  });

  it("clears the alert and restores the preview after a previously failing template becomes valid", async () => {
    // Start with a bad template so the alert fires.
    vi.mocked(previewOutputName).mockRejectedValue(
      "invalid naming template: stray or malformed brace",
    );
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: "~/Archives",
      },
    });
    render(<OutputSettings />);

    // Wait for the initial error alert to appear.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);

    // Switch to a good template: the mock now resolves successfully.
    vi.mocked(previewOutputName).mockResolvedValue("photo_001.zip");
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, namingTemplate: "photo_{n:03}" },
      }));
    });

    // The alert must disappear and the resolved full path must appear.
    await waitFor(() => {
      expect(screen.queryByRole("alert")).toBeNull();
    });
    await screen.findByText("~/Archives/photo_001.zip");
  });

  it("shows an Add files chip when the queue is empty", () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: "photo_{n:03}", outputDir: "~/out" },
    });
    render(<OutputSettings />);

    expect(screen.getByText("Add files")).toBeDefined();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows a Choose a destination chip when no destination is set", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: "photo_{n:03}",
        outputDir: null,
      },
    });
    render(<OutputSettings />);

    expect(screen.getByText("Choose a destination")).toBeDefined();
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("shows Ready when items exist and a destination is set", () => {
    useJobStore.setState({
      draft: {
        items: [{ path: "/a.rar", kind: "rar" }],
        namingTemplate: "photo_{n:03}",
        outputDir: "~/out",
      },
    });
    render(<OutputSettings />);

    expect(screen.getByText("Ready")).toBeDefined();
    expect(screen.queryByText("Add files")).toBeNull();
    expect(screen.queryByText("Choose a destination")).toBeNull();
  });

  it("computes the preview from the current template via previewOutputName(seq=1)", async () => {
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "img_{n:02}",
        outputDir: "~/Archives",
      },
    });
    render(<OutputSettings />);

    await waitFor(() => {
      expect(vi.mocked(previewOutputName)).toHaveBeenCalledWith(
        "img_{n:02}",
        1,
      );
    });
  });

  // Regression: when the template preview rejects and outputDir is set, the
  // component must not render the directory path alone (e.g. "~/Archives/")
  // in the full-path preview area. The alert itself is still shown; only
  // the isolated directory must be absent from the monospace preview span.
  it("does not render directory-only path after a preview error with outputDir set", async () => {
    vi.mocked(previewOutputName).mockRejectedValue(
      "invalid naming template: stray or malformed brace",
    );
    useJobStore.setState({
      draft: {
        items: [],
        namingTemplate: "photo_{n",
        outputDir: "~/Archives",
      },
    });
    render(<OutputSettings />);

    // Wait for the alert to appear to confirm the error path was reached.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/invalid naming template/i);

    // The full-path preview span (font-mono) must not exist in the DOM.
    // queryAllByText with the exact trailing-slash string checks the specific
    // rendered output; the destination picker shows "~/Archives" without the
    // slash so a queryByText for the slash-terminated form is unambiguous.
    expect(screen.queryByText("~/Archives/")).toBeNull();
  });

  // When the store has not pushed a namingTemplate yet (null), OutputSettings
  // must fall back to DEFAULT_TEMPLATE when calling previewOutputName.
  it("falls back to DEFAULT_TEMPLATE when store namingTemplate is null", async () => {
    useJobStore.setState({
      draft: { items: [], namingTemplate: null, outputDir: "~/Archives" },
    });
    render(<OutputSettings />);

    await waitFor(() => {
      expect(vi.mocked(previewOutputName)).toHaveBeenCalledWith(
        DEFAULT_TEMPLATE,
        1,
      );
    });
  });
});
