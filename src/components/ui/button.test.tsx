import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "./button";

describe("Button variants", () => {
  it("renders the brand variant with the red brand fill and pill shape", () => {
    render(<Button variant="brand">Compress</Button>);
    const btn = screen.getByRole("button", { name: /compress/i });
    expect(btn.className).toContain("bg-brand");
    expect(btn.className).toContain("rounded-full");
  });

  it("keeps the default variant on the navy primary background", () => {
    render(<Button>Select folder</Button>);
    const btn = screen.getByRole("button", { name: /select folder/i });
    expect(btn.className).toContain("bg-primary");
  });
});
