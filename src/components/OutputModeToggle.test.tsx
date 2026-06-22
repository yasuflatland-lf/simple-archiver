import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { OutputModeToggle } from "@/components/OutputModeToggle";
import { resetJobStore, useJobStore } from "@/store/jobStore";

afterEach(() => resetJobStore());

it("renders zip selected by default and switches to folder on click", () => {
  const spy = vi
    .spyOn(useJobStore.getState(), "setOutputMode")
    .mockResolvedValue();

  render(<OutputModeToggle />);

  const zip = screen.getByRole("radio", { name: /rebundle to zip file/i });
  const folder = screen.getByRole("radio", { name: /unarchive to folders/i });
  expect(zip.getAttribute("aria-checked")).toBe("true");
  expect(folder.getAttribute("aria-checked")).toBe("false");

  fireEvent.click(folder);
  expect(spy).toHaveBeenCalledWith("folder");
});
