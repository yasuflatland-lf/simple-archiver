import { type Theme, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

const ORDER: readonly Theme[] = ["light", "dark", "system"];

// Single-glyph icon per theme mode (sun / moon / monitor outline).
const ICON: Record<Theme, string> = {
  light:
    "M12 3v2m0 14v2m9-9h-2M5 12H3m14.95 6.95-1.41-1.41M6.46 6.46 5.05 5.05m12.49 0-1.41 1.41M6.46 17.54l-1.41 1.41",
  dark: "M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z",
  system: "M3 4h18v12H3zM8 20h8M12 16v4",
};

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  const next = () => {
    const i = ORDER.indexOf(theme);
    setTheme(ORDER[(i + 1) % ORDER.length]);
  };

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Toggle theme (current: ${theme})`}
      onClick={next}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {theme === "light" ? <circle cx="12" cy="12" r="4" /> : null}
        <path d={ICON[theme]} />
      </svg>
    </Button>
  );
}
