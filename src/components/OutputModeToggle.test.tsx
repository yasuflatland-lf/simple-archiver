import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { OutputModeToggle } from "@/components/OutputModeToggle";
import { resetJobStore, useJobStore } from "@/store/jobStore";

afterEach(() => resetJobStore());

it("renders the radiogroup with short pill labels, zip selected by default", () => {
  render(<OutputModeToggle />);

  expect(screen.getByRole("radiogroup", { name: /output as/i })).toBeTruthy();
  const zip = screen.getByRole("radio", { name: /zip files/i });
  const folder = screen.getByRole("radio", { name: /folders/i });
  expect(zip.getAttribute("aria-checked")).toBe("true");
  expect(folder.getAttribute("aria-checked")).toBe("false");
  // The sliding thumb is decorative and present for the visual treatment.
  expect(screen.getByTestId("mode-thumb")).toBeTruthy();
});

it("calls setOutputMode('folder') when the Folders segment is clicked", () => {
  const spy = vi
    .spyOn(useJobStore.getState(), "setOutputMode")
    .mockResolvedValue();

  render(<OutputModeToggle />);
  fireEvent.click(screen.getByRole("radio", { name: /folders/i }));
  expect(spy).toHaveBeenCalledWith("folder");
});
