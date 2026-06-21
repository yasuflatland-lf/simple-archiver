/**
 * The shell header: product title on the left.
 * Rendered into AppShell's `header` slot (which supplies the flex justify).
 */
export function AppHeader() {
  return (
    <div className="flex items-center gap-2">
      {/* Decorative: the adjacent title conveys the product name to AT. */}
      <img
        src="/logo.png"
        alt=""
        aria-hidden="true"
        width={24}
        height={24}
        className="size-6"
      />
      <h1 className="text-lg font-bold tracking-[-0.36px] text-heading">
        simple-archiver
      </h1>
    </div>
  );
}
