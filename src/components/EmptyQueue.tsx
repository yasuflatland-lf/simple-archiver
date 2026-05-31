import { AddSourceButtons } from "@/components/AddSourceButtons";

/**
 * The empty-state shown in the main region when the queue has no items. Makes
 * drag-and-drop the hero (it accepts both files and folders), with the two
 * browse buttons as the keyboard/no-DnD fallback. `h-full` so it fills the
 * scroll region and centers its content.
 */
export function EmptyQueue() {
  return (
    <div
      data-testid="empty-queue"
      className="flex h-full flex-col items-center justify-center gap-4 rounded-lg border-2 border-dashed border-border p-10 text-center text-muted-foreground"
    >
      <span aria-hidden="true" className="text-3xl">
        ⬇
      </span>
      <p className="text-base font-medium text-foreground">
        Drag &amp; drop files or folders
      </p>
      <p className="text-sm">
        Drop .rar files or whole folders here to queue them.
      </p>
      <AddSourceButtons />
    </div>
  );
}
