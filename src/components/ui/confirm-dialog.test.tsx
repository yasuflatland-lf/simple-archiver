import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "./confirm-dialog";

const baseProps = {
  title: "Clear Queue",
  description: "This action cannot be undone.",
  confirmLabel: "Clear",
  cancelLabel: "Cancel",
  onConfirm: vi.fn(),
  onCancel: vi.fn(),
};

describe("ConfirmDialog – closed state", () => {
  it("renders nothing when open is false", () => {
    render(<ConfirmDialog {...baseProps} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ConfirmDialog – open state", () => {
  it("renders the dialog with role='dialog' when open is true", () => {
    render(<ConfirmDialog {...baseProps} open={true} />);
    expect(screen.queryByRole("dialog")).not.toBeNull();
  });

  it("displays title, description, confirmLabel, and cancelLabel", () => {
    render(<ConfirmDialog {...baseProps} open={true} />);
    expect(screen.getByText("Clear Queue")).toBeTruthy();
    expect(screen.getByText("This action cannot be undone.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });

  it("does not render description element when description prop is omitted", () => {
    const { title, confirmLabel, cancelLabel, onConfirm, onCancel } = baseProps;
    render(
      <ConfirmDialog
        open={true}
        title={title}
        confirmLabel={confirmLabel}
        cancelLabel={cancelLabel}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    // The dialog and title/buttons should exist; no description text from baseProps
    expect(screen.queryByText("This action cannot be undone.")).toBeNull();
  });
});

describe("ConfirmDialog – interactions", () => {
  it("calls onConfirm when Confirm button is clicked", async () => {
    const onConfirm = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} open={true} onConfirm={onConfirm} />);
    await user.click(screen.getByRole("button", { name: "Clear" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Cancel button is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when Escape key is pressed", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel once when the backdrop is clicked", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    const { container } = render(
      <ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />,
    );
    // The backdrop is the aria-hidden div rendered before the dialog panel.
    const backdrop = container.querySelector("[aria-hidden='true']");
    expect(backdrop).not.toBeNull();
    await user.click(backdrop!);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("does not call onCancel when clicking inside the dialog panel", async () => {
    const onCancel = vi.fn();
    const user = userEvent.setup();
    render(<ConfirmDialog {...baseProps} open={true} onCancel={onCancel} />);
    // Click the title text, which lives inside the content card (stopPropagation boundary).
    await user.click(screen.getByText("Clear Queue"));
    expect(onCancel).not.toHaveBeenCalled();
  });
});
