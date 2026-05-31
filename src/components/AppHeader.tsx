import { ModeToggle } from "@/components/mode-toggle";

/**
 * The shell header: product title on the left, theme toggle on the right.
 * Rendered into AppShell's `header` slot (which supplies the flex justify).
 */
export function AppHeader() {
  return (
    <>
      <div className="flex items-center gap-2">
        <span aria-hidden="true">📦</span>
        <h1 className="text-lg font-bold tracking-[-0.36px] text-heading">
          simple-archiver
        </h1>
      </div>
      <ModeToggle />
    </>
  );
}
