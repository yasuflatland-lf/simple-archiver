import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { NamingRuleForm, DEBOUNCE_MS } from "./NamingRuleForm";

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

  it("debounces rapid typing into a single backend call", async () => {
    // Use fake timers so we can control the debounce window precisely without
    // relying on real-clock timing. fireEvent is used instead of userEvent
    // because userEvent's internal async queuing conflicts with fake timers.
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue("x.zip");
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/naming template/i);

      // Simulate the initial mount settling, then clear the counter.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      vi.mocked(invoke).mockClear();

      // Fire five rapid change events (simulating "abcde" being typed one
      // character at a time) without advancing the clock between them.
      // With the debounce in place, each keystroke resets the timer so only
      // the LAST value triggers an invoke once the window expires.
      for (const ch of ["a", "ab", "abc", "abcd", "abcde"]) {
        act(() => {
          fireEvent.change(input, { target: { value: ch } });
        });
      }

      // Still inside the debounce window — no call should have fired yet.
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(0);

      // Advance past the debounce window; exactly ONE call must fire.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("shows an Error's message when the backend rejects with an Error", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("backend exploded"));
    render(<NamingRuleForm />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/backend exploded/i);
    // Pins that we extract .message, not String(error) which would be "Error: backend exploded"
    expect(alert.textContent ?? "").not.toMatch(/^Error:/);
  });

  it("shows a friendly fallback when the rejection is neither a string nor an Error", async () => {
    vi.mocked(invoke).mockRejectedValue({ unexpected: true });
    render(<NamingRuleForm />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").toMatch(/could not generate a preview/i);
  });

  it("clears a previous error once a valid template resolves", async () => {
    vi.mocked(invoke)
      .mockRejectedValueOnce("invalid naming template: stray or malformed brace")
      .mockResolvedValue("ok_1.zip");
    const user = userEvent.setup();
    render(<NamingRuleForm />);
    // Wait for the initial rejected invoke to surface an error alert.
    await screen.findByRole("alert", {}, { timeout: 2000 });
    // Typing a character changes the template; the next resolved call must
    // clear the error and show the new preview.
    const input = screen.getByLabelText(/naming template/i);
    await user.type(input, "x");
    await screen.findByText(/ok_1\.zip/, {}, { timeout: 2000 });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
