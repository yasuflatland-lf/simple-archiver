import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetJobStore, useJobStore } from "@/store/jobStore";

import { DEBOUNCE_MS, StartNumberForm } from "./StartNumberForm";

describe("StartNumberForm", () => {
  beforeEach(() => {
    // Reset store, then replace setStartNumber with a spy so the real action
    // never calls the backend during these tests.
    resetJobStore();
    const setStartNumber = vi.fn();
    useJobStore.setState({ setStartNumber });
  });

  it("renders the Start heading and seeds the input with the default start", () => {
    render(<StartNumberForm />);

    expect(screen.getByText("Start #")).toBeDefined();
    const input = screen.getByLabelText(/start/i) as HTMLInputElement;
    expect(input.value).toBe("1");
  });

  it("seeds the input from a non-default store start", () => {
    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, startNumber: 7 },
      }));
    });

    render(<StartNumberForm />);

    const input = screen.getByLabelText(/start/i) as HTMLInputElement;
    expect(input.value).toBe("7");
  });

  it("syncs the input when the store start changes from outside the form", () => {
    render(<StartNumberForm />);

    const input = screen.getByLabelText(/start/i) as HTMLInputElement;
    expect(input.value).toBe("1");

    act(() => {
      useJobStore.setState((s) => ({
        draft: { ...s.draft, startNumber: 9 },
      }));
    });

    expect(input.value).toBe("9");
  });

  it("keeps the typed text when its own debounce push echoes back through the store", async () => {
    vi.useFakeTimers();
    try {
      // Mimic the real action: the pushed start lands in the store draft, so the
      // form observes its own value coming back as a store change.
      const setStartNumber = vi.fn(async (start: number) => {
        useJobStore.setState((s) => ({
          draft: { ...s.draft, startNumber: start },
        }));
      });
      useJobStore.setState({ setStartNumber });
      render(<StartNumberForm />);
      const input = screen.getByLabelText(/start/i) as HTMLInputElement;

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      setStartNumber.mockClear();

      act(() => {
        fireEvent.change(input, { target: { value: "05" } });
      });
      // Advance inside act so the re-render triggered by the echo is flushed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      });
      expect(useJobStore.getState().draft.startNumber).toBe(5);
      // The echo matches the field's sanitized value, so the raw text survives.
      expect(input.value).toBe("05");

      // No push-back loop: the echo must not rewrite the field (to "5") and
      // re-arm the debounce, so nothing more is pushed.
      await act(async () => {
        await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
      });
      expect(setStartNumber).toHaveBeenCalledTimes(1);
      expect(setStartNumber).toHaveBeenCalledWith(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("calls setStartNumber with the parsed integer after the debounce delay", async () => {
    vi.useFakeTimers();
    try {
      render(<StartNumberForm />);
      const input = screen.getByLabelText(/start/i);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setStartNumber = vi.mocked(
        useJobStore.getState().setStartNumber as ReturnType<typeof vi.fn>,
      );
      setStartNumber.mockClear();

      act(() => {
        fireEvent.change(input, { target: { value: "5" } });
      });
      expect(setStartNumber).toHaveBeenCalledTimes(0);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(setStartNumber).toHaveBeenCalledTimes(1);
      expect(setStartNumber).toHaveBeenCalledWith(5);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clamps a negative entry to 0 before pushing", async () => {
    vi.useFakeTimers();
    try {
      render(<StartNumberForm />);
      const input = screen.getByLabelText(/start/i);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setStartNumber = vi.mocked(
        useJobStore.getState().setStartNumber as ReturnType<typeof vi.fn>,
      );
      setStartNumber.mockClear();

      act(() => {
        fireEvent.change(input, { target: { value: "-3" } });
      });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(setStartNumber).toHaveBeenCalledWith(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not push a non-integer entry (leaves the stored start unchanged)", async () => {
    vi.useFakeTimers();
    try {
      render(<StartNumberForm />);
      const input = screen.getByLabelText(/start/i);

      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
      const setStartNumber = vi.mocked(
        useJobStore.getState().setStartNumber as ReturnType<typeof vi.fn>,
      );
      setStartNumber.mockClear();

      act(() => {
        fireEvent.change(input, { target: { value: "1.5" } });
      });
      await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
      expect(setStartNumber).toHaveBeenCalledTimes(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
