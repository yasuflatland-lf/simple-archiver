import { useEffect, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DEFAULT_START, sanitizeStartNumber } from "@/lib/naming";
import { cn } from "@/lib/utils";
import { useJobStore } from "@/store/jobStore";

// Wait this long after the last keystroke before pushing the start number into
// the store, so we make one store/IPC round-trip per typing pause rather than
// one per character.
export const DEBOUNCE_MS = 200;

/**
 * The "Start #" control inside the OUTPUT group: a debounced number input that
 * pushes the sequence start number into the store via setStartNumber. The live
 * preview reflects the start through the left rail's hero path.
 *
 * Renders as a self-contained vertical block (a tier-2 "Start #" label above the
 * number input) so it stacks cleanly in the left rail.
 *
 * The field keeps its own raw text so a partial edit (empty, "-", "1.") is
 * representable while typing; only a sanitized integer is pushed to the store.
 */
export function StartNumberForm({
  hideLabel = false,
}: { hideLabel?: boolean } = {}) {
  // Source the initial value from the store so a non-default draft start (future
  // session restore, or a seeded test) shows the correct value rather than the
  // compile-time default.
  const storedStart = useJobStore((s) => s.draft.startNumber);
  const [startText, setStartText] = useState(
    String(storedStart ?? DEFAULT_START),
  );

  useEffect(() => {
    const handle = setTimeout(() => {
      const parsed = sanitizeStartNumber(startText);
      // null = not a usable integer yet (mid-edit); leave the stored value as is.
      if (parsed !== null) {
        useJobStore.getState().setStartNumber(parsed);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [startText]);

  // Sync the field when the store start changes from OUTSIDE this form (e.g.
  // session restore). Depend only on `storedStart` so this reacts to external
  // store changes, not to local keystrokes (which already drive the debounce
  // push above). The functional updater compares the field's sanitized value to
  // the stored one, so when our own debounce pushes the value back this is a
  // no-op and starts no update cycle.
  useEffect(() => {
    setStartText((current) =>
      sanitizeStartNumber(current) === storedStart
        ? current
        : String(storedStart),
    );
  }, [storedStart]);

  return (
    <div className="flex flex-col gap-1.5">
      <Label
        htmlFor="start-number"
        className={cn(
          "text-xs font-medium uppercase tracking-[0.96px] text-muted-foreground",
          hideLabel && "sr-only",
        )}
      >
        Start #
      </Label>
      <Input
        id="start-number"
        type="number"
        min={0}
        step={1}
        value={startText}
        onChange={(event) => setStartText(event.target.value)}
      />
    </div>
  );
}
