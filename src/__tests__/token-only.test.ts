import { describe, expect, it } from "vitest";

// Raw Tailwind palette utilities that bypass the semantic token layer. Any of
// these in a component className is "un-themed style leakage". Tokens like
// bg-background / text-muted-foreground / bg-category-* are allowed.
const RAW_COLOR =
  /\b(?:bg|text|border|ring|from|to|via|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;

// Eagerly import every source file as raw text via Vite's glob. This works in
// Vitest and is fully typed via vite/client, so it needs no Node fs/path/process
// and keeps the `tsc` type gate green. Excluded: test files (they legitimately
// mention palette names — this very regex does) and vendored shadcn primitives
// under components/ui/** (token-based already).
const sources = import.meta.glob("/src/**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

describe("token-only composition", () => {
  it("no source file uses raw Tailwind palette colors", () => {
    const offenders: string[] = [];
    for (const [path, text] of Object.entries(sources)) {
      if (path.includes("/components/ui/")) continue;
      if (/\.test\.(ts|tsx)$/.test(path)) continue;
      for (const line of text.split("\n")) {
        if (RAW_COLOR.test(line)) offenders.push(`${path}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
