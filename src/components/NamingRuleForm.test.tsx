import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { NamingRuleForm } from "./NamingRuleForm";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("NamingRuleForm", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
  });

  it("shows the preview returned by the backend as the template changes", async () => {
    vi.mocked(invoke).mockResolvedValue("img_001.zip");
    const user = userEvent.setup();
    render(<NamingRuleForm />);

    const input = screen.getByLabelText(/naming template/i);
    await user.clear(input);
    await user.type(input, "img_{{n:03}");

    await screen.findByText(/img_001\.zip/);
    expect(vi.mocked(invoke)).toHaveBeenLastCalledWith("preview_output_name", {
      template: "img_{n:03}",
      seq: 1,
    });
  });

  it("shows an error when the backend rejects the template", async () => {
    vi.mocked(invoke).mockRejectedValue("invalid naming template: stray or malformed brace");
    render(<NamingRuleForm />);

    await waitFor(async () => {
      const alert = await screen.findByRole("alert");
      expect(alert.textContent ?? "").toMatch(/invalid naming template/i);
    });
  });
});
