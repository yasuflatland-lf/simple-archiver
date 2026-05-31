import * as React from "react";

import { Button } from "@/components/ui/button";

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * ConfirmDialog — lightweight self-contained modal for destructive confirmations.
 * Renders nothing when `open` is false. All visible text comes from props; no
 * hard-coded strings are embedded in this component.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  const titleId = React.useId();
  const descriptionId = React.useId();
  const confirmRef = React.useRef<HTMLButtonElement>(null);

  // Move focus to the Confirm button when the dialog opens.
  React.useEffect(() => {
    if (open) {
      confirmRef.current?.focus();
    }
  }, [open]);

  // Close on Escape key.
  React.useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onCancel();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, onCancel]);

  if (!open) {
    return null;
  }

  return (
    <>
      {/* Backdrop — clicking it calls onCancel. Hidden from AT since the dialog panel handles semantics. */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: keyboard dismiss is handled by the document Escape listener */}
      <div
        className="fixed inset-0 z-50 bg-black/50"
        onClick={onCancel}
        aria-hidden="true"
      />
      {/* Dialog panel — positioned above the backdrop; stop propagation so panel clicks do not reach the backdrop. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className="fixed inset-0 z-[51] flex items-center justify-center"
        // biome-ignore lint/a11y/useKeyWithClickEvents: click here is on the centering wrapper, not a focusable element
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-sm rounded-lg border bg-background p-6 shadow-lg">
          <h2
            id={titleId}
            className="mb-2 text-base font-semibold leading-none tracking-tight"
          >
            {title}
          </h2>
          {description && (
            <p
              id={descriptionId}
              className="mb-6 text-sm text-muted-foreground"
            >
              {description}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onCancel}>
              {cancelLabel}
            </Button>
            <Button
              type="button"
              variant="destructive"
              ref={confirmRef}
              onClick={onConfirm}
            >
              {confirmLabel}
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
