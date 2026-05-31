import { type LucideIcon, Monitor, Moon, Sun } from "lucide-react";

import { type Theme, useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";

const ORDER: readonly Theme[] = ["light", "dark", "system"];

// One Lucide glyph per theme mode. The svg is decorative; the button's
// aria-label carries the accessible name.
const ICON: Record<Theme, LucideIcon> = {
  light: Sun,
  dark: Moon,
  system: Monitor,
};

export function ModeToggle() {
  const { theme, setTheme } = useTheme();

  const next = () => {
    const i = ORDER.indexOf(theme);
    setTheme(ORDER[(i + 1) % ORDER.length]);
  };

  const Icon = ICON[theme];

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={`Toggle theme (current: ${theme})`}
      onClick={next}
    >
      <Icon aria-hidden="true" />
    </Button>
  );
}
