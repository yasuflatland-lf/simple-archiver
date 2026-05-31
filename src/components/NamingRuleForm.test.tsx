import { invoke } from "@tauri-apps/api/core";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { DEBOUNCE_MS, NamingRuleForm } from "./NamingRuleForm";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

describe("NamingRuleForm", () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    // Reset store to initial state, then replace setNamingRule with a spy so
    // the real action never calls invoke("set_naming_rule") and pollutes the
    // existing preview_output_name invoke assertions.
    resetJobStore();
    const setNamingRule = vi.fn();
    useJobStore.setState({ setNamingRule });
  });

  it("shows the preview returned by the backend as the template changes", async () => {
    vi.mocked(invoke).mockResolvedValue("img_001.zip");
    const user = userEvent.setup();
    render(<NamingRuleForm />);

    const input = screen.getByLabelText(/naming template/i);
    await user.clear(input);
    await user.type(input, "img_{{n:03}");

    await screen.findByText(/img_001\.zip/);
    // Assert the backend was eventually invoked with the fully-typed template,
    // NOT that it was the *last* call. The mock returns the same preview for
    // every input, so under a slow runner the post-clear empty-template debounce
    // can fire last and make toHaveBeenLastCalledWith see template: "" — a
    // timing-dependent failure. waitFor + toHaveBeenCalledWith is deterministic.
    await waitFor(() =>
      expect(vi.mocked(invoke)).toHaveBeenCalledWith("preview_output_name", {
        template: "img_{n:03}",
        seq: 1,
      }),
    );
  });

  it("shows an error when the backend rejects the template", async () => {
    vi.mocked(invoke).mockRejectedValue(
      "invalid naming template: stray or malformed brace",
    );
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
      .mockRejectedValueOnce(
        "invalid naming template: stray or malformed brace",
      )
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

  it("calls setNamingRule once after the debounce delay elapses", async () => {
    // Use fake timers to control the debounce window precisely, mirroring the
    // existing debounce test technique.
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue("new_1.zip");
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/naming template/i);

      // Let the initial mount debounce settle so we can start from a clean spy.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setNamingRule = vi.mocked(
        useJobStore.getState().setNamingRule as ReturnType<typeof vi.fn>,
      );
      setNamingRule.mockClear();

      // Change the template value.
      act(() => {
        fireEvent.change(input, { target: { value: "new_template_{n}" } });
      });

      // Inside the debounce window — store action must NOT have fired yet.
      expect(setNamingRule).toHaveBeenCalledTimes(0);

      // Advance past the debounce window; the spy must be called exactly once
      // with the new template string.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(setNamingRule).toHaveBeenCalledTimes(1);
      expect(setNamingRule).toHaveBeenCalledWith("new_template_{n}");
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not call setNamingRule before the debounce delay elapses", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(invoke).mockResolvedValue("x.zip");
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/naming template/i);

      // Let the initial mount settle, then clear.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setNamingRule = vi.mocked(
        useJobStore.getState().setNamingRule as ReturnType<typeof vi.fn>,
      );
      setNamingRule.mockClear();

      // Rapid changes — each resets the debounce timer.
      for (const val of ["a", "ab", "abc"]) {
        act(() => {
          fireEvent.change(input, { target: { value: val } });
        });
      }

      // Still inside the window — no call yet.
      expect(setNamingRule).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
