import { type ReactNode, useEffect } from "react";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Applies the OS color-scheme preference to <html> and keeps it in sync as the
 * preference changes. The app always follows the OS; there is no manual toggle.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    const root = window.document.documentElement;
    const media = window.matchMedia(DARK_QUERY);

    const apply = () => {
      root.classList.remove("light", "dark");
      root.classList.add(media.matches ? "dark" : "light");
    };

    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, []);

  return <>{children}</>;
}
