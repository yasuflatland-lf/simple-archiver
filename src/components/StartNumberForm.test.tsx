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
