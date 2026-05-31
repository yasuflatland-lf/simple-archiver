import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DropOverlay } from "./DropOverlay";

describe("DropOverlay", () => {
  it("renders nothing when not visible", () => {
    render(<DropOverlay visible={false} />);
    expect(screen.queryByTestId("drop-overlay")).toBeNull();
  });

  it("renders a token-styled overlay when visible", () => {
    render(<DropOverlay visible={true} />);
    const overlay = screen.getByTestId("drop-overlay");
    expect(overlay.className).toContain("fixed");
    expect(overlay.className).toContain("border-primary");
    expect(overlay.className).toContain("bg-primary/10");
    expect(overlay.textContent).toMatch(/drop to add/i);
  });
});
