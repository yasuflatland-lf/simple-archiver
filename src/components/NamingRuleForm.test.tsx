import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import {
  DEBOUNCE_MS,
  DEFAULT_TEMPLATE,
  NamingRuleForm,
} from "./NamingRuleForm";

describe("NamingRuleForm", () => {
  beforeEach(() => {
    // Reset store, then replace setNamingRule with a spy so the real action
    // never calls the backend during these tests.
    resetJobStore();
    const setNamingRule = vi.fn();
    useJobStore.setState({ setNamingRule });
  });

  it("renders the Name heading and seeds the input with the default template", () => {
    render(<NamingRuleForm />);

    expect(screen.getByText("Name")).toBeDefined();
    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_TEMPLATE);
  });

  it("seeds the input from a non-default store template", () => {
    // Seed the store as if a prior session / test restored a custom template.
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, namingTemplate: "stored_{n}" },
      }));
    });

    render(<NamingRuleForm />);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe("stored_{n}");
  });

  it("syncs the input when the store template changes from outside the form", () => {
    render(<NamingRuleForm />);

    const input = screen.getByLabelText(/name/i) as HTMLInputElement;
    expect(input.value).toBe(DEFAULT_TEMPLATE);

    // An external store update (not a keystroke) must flow into the field.
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, namingTemplate: "external_{n}" },
      }));
    });

    expect(input.value).toBe("external_{n}");
  });

  it("does not render an inline preview line (preview moved to OutputSettings)", () => {
    render(<NamingRuleForm />);

    expect(screen.queryByText(/^Preview:/)).toBeNull();
  });

  it("calls setNamingRule once after the debounce delay elapses", async () => {
    vi.useFakeTimers();
    try {
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/name/i);

      // Let the initial mount debounce settle so we can start from a clean spy.
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setNamingRule = vi.mocked(
        useJobStore.getState().setNamingRule as ReturnType<typeof vi.fn>,
      );
      setNamingRule.mockClear();

      act(() => {
        fireEvent.change(input, { target: { value: "new_template_{n}" } });
      });

      // Inside the debounce window — store action must NOT have fired yet.
      expect(setNamingRule).toHaveBeenCalledTimes(0);

      // Advance past the window; the spy must be called exactly once.
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
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/name/i);

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

  it("debounces rapid typing into a single store push", async () => {
    vi.useFakeTimers();
    try {
      render(<NamingRuleForm />);
      const input = screen.getByLabelText(/name/i);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setNamingRule = vi.mocked(
        useJobStore.getState().setNamingRule as ReturnType<typeof vi.fn>,
      );
      setNamingRule.mockClear();

      for (const ch of ["a", "ab", "abc", "abcd", "abcde"]) {
        act(() => {
          fireEvent.change(input, { target: { value: ch } });
        });
      }

      expect(setNamingRule).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(setNamingRule).toHaveBeenCalledTimes(1);
      expect(setNamingRule).toHaveBeenCalledWith("abcde");
    } finally {
      vi.useRealTimers();
    }
  });
});
