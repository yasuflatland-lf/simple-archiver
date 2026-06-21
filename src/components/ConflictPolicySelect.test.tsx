import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { ConflictPolicySelect } from "@/components/ConflictPolicySelect";
import { resetJobStore, useJobStore } from "@/store/jobStore";

afterEach(() => {
  vi.restoreAllMocks();
  resetJobStore();
});

it("renders Auto-rename selected by default and switches on click", () => {
  const spy = vi
    .spyOn(useJobStore.getState(), "setConflictPolicy")
    .mockResolvedValue();

  render(<ConflictPolicySelect />);

  const autoRename = screen.getByRole("radio", { name: /auto-rename/i });
  const skip = screen.getByRole("radio", { name: /skip/i });
  const overwrite = screen.getByRole("radio", { name: /overwrite/i });
  expect(autoRename.getAttribute("aria-checked")).toBe("true");
  expect(skip.getAttribute("aria-checked")).toBe("false");
  expect(overwrite.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(overwrite);
  expect(spy).toHaveBeenCalledWith("overwrite");
});

it("reflects the store's current policy", () => {
  useJobStore.setState({
    draft: {
      items: [],
      namingTemplate: null,
      outputDir: null,
      outputMode: "folder",
      conflictPolicy: "skip",
    },
  });

  render(<ConflictPolicySelect />);

  expect(
    screen.getByRole("radio", { name: /skip/i }).getAttribute("aria-checked"),
  ).toBe("true");
});

it("does not re-push the policy when the current one is clicked", () => {
  const spy = vi
    .spyOn(useJobStore.getState(), "setConflictPolicy")
    .mockResolvedValue();

  render(<ConflictPolicySelect />);

  fireEvent.click(screen.getByRole("radio", { name: /auto-rename/i }));
  expect(spy).not.toHaveBeenCalled();
});
