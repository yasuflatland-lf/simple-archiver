import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { pickDirectory } from "@/lib/dialog";
import { resetJobStore, useJobStore } from "@/store/jobStore";

import { ResultPreview } from "./ResultPreview";

vi.mock("@/lib/dialog", () => ({ pickDirectory: vi.fn() }));

// Build a full draft snapshot so setState replaces the draft wholesale.
function setDraft(over: Partial<ReturnType<typeof base>> = {}) {
  useJobStore.setState({ draft: { ...base(), ...over } });
}
function base() {
  return {
    items: [] as { path: string; kind: "rar" | "zip" }[],
    namingTemplate: null as string | null,
    startNumber: 1,
    outputDir: null as string | null,
    outputMode: "zip" as "zip" | "folder",
    conflictPolicy: "autoRename" as const,
  };
}

describe("ResultPreview", () => {
  beforeEach(() => {
    resetJobStore();
    vi.mocked(pickDirectory).mockReset();
  });

  it("shows the empty state with Required and a Choose folder action when no destination", () => {
    setDraft({ outputDir: null });
    render(<ResultPreview />);
    expect(screen.getByText("Required")).toBeTruthy();
    expect(screen.getByRole("button", { name: /choose folder/i })).toBeTruthy();
  });

  it("invokes the picker and setOutputDir from the empty-state action", async () => {
    setDraft({ outputDir: null });
    vi.mocked(pickDirectory).mockResolvedValue("/picked");
    const setOutputDir = vi.fn().mockResolvedValue(undefined);
    useJobStore.setState({ setOutputDir });
    const user = userEvent.setup();

    render(<ResultPreview />);
    await user.click(screen.getByRole("button", { name: /choose folder/i }));

    await waitFor(() => expect(setOutputDir).toHaveBeenCalledWith("/picked"));
  });

  it("shows the first filename and file count in zip mode when ready", () => {
    setDraft({
      outputDir: "/out",
      outputMode: "zip",
      items: [
        { path: "/a.rar", kind: "rar" },
        { path: "/b.rar", kind: "rar" },
      ],
    });
    useJobStore.setState({ firstPreview: "photo_01.zip", previewError: null });
    render(<ResultPreview />);

    expect(screen.getByText("photo_01.zip")).toBeTruthy();
    expect(screen.getByText(/2 files/i)).toBeTruthy();
    expect(screen.getByText("/out")).toBeTruthy();
    expect(screen.getByRole("button", { name: /change/i })).toBeTruthy();
  });

  it("shows a representative folder and archive count in folder mode", () => {
    setDraft({
      outputDir: "/out",
      outputMode: "folder",
      items: [{ path: "/photos/vacation.rar", kind: "rar" }],
    });
    render(<ResultPreview />);

    expect(screen.getByText("vacation/")).toBeTruthy();
    expect(screen.getByText(/1 archive\b/i)).toBeTruthy();
  });

  it("shows the preview error as an alert in zip mode", () => {
    setDraft({ outputDir: "/out", outputMode: "zip" });
    useJobStore.setState({ firstPreview: "", previewError: "bad template" });
    render(<ResultPreview />);

    expect(screen.getByRole("alert").textContent).toContain("bad template");
  });

  it("shows a loading placeholder in zip mode while the preview is pending", () => {
    setDraft({
      outputDir: "/out",
      outputMode: "zip",
      items: [{ path: "/a.rar", kind: "rar" }],
    });
    useJobStore.setState({ firstPreview: null, previewError: null });
    render(<ResultPreview />);

    expect(screen.getByText(/preparing preview/i)).toBeTruthy();
  });
});
