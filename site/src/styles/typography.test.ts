/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Read the landing-page stylesheet as text and assert the typeface contract
// directly. jsdom does not apply @font-face or resolve the cascade, and vitest
// stubs CSS imports to empty strings, so reading the source file is the reliable
// way to lock in that the site renders in the bundled D-DIN face (the same DIN
// grotesque SpaceX uses). Vitest runs with the package root as its cwd, so the
// sheet resolves from there.
const css = readFileSync(
  resolve(process.cwd(), "src/styles/index.css"),
  "utf8",
);

// Collect every top-level `<selector> { ... }` body for a bare element
// selector. These rules contain no nested braces, so a non-greedy match up to
// the first closing brace returns each block's declarations.
function ruleBodies(selector: string): string[] {
  const re = new RegExp(`(?:^|[}\\n])\\s*${selector}\\s*{([^}]*)}`, "g");
  return [...css.matchAll(re)].map((match) => match[1]);
}

function dDinFontFaces(): string[] {
  const fontFaces = css.match(/@font-face\s*{[^}]*}/g) ?? [];
  return fontFaces.filter((block) => /font-family:\s*"D-DIN"/.test(block));
}

describe("display heading typeface", () => {
  it("self-hosts the D-DIN face as a bundled woff2 bold weight", () => {
    const bold = dDinFontFaces().find((block) =>
      /font-weight:\s*700/.test(block),
    );

    expect(
      bold,
      'expected an @font-face declaring "D-DIN" at weight 700',
    ).toBeTruthy();
    expect(bold).toMatch(/\.woff2/);
  });

  it("exposes a --font-display stack that resolves D-DIN first", () => {
    expect(css).toMatch(/--font-display:\s*"D-DIN"/);
  });

  it("applies the D-DIN display stack at bold weight to h1 and h2", () => {
    for (const heading of ["h1", "h2"]) {
      const usesDisplayFace = ruleBodies(heading).some(
        (body) =>
          /font-family:\s*var\(--font-display\)/.test(body) &&
          /font-weight:\s*700/.test(body),
      );

      expect(
        usesDisplayFace,
        `expected a ${heading} rule using var(--font-display) at weight 700`,
      ).toBe(true);
    }
  });
});

describe("site-wide D-DIN type system", () => {
  it("ships both a regular (400) and bold (700) D-DIN woff2", () => {
    const weights = dDinFontFaces().map(
      (block) => (block.match(/font-weight:\s*(\d+)/) ?? [])[1],
    );

    expect(weights).toContain("400");
    expect(weights).toContain("700");
    for (const face of dDinFontFaces()) {
      expect(face).toMatch(/\.woff2/);
    }
  });

  it("uses the D-DIN stack as the document base font", () => {
    const usesBase = ruleBodies("body").some((body) =>
      /font-family:\s*var\(--font-display\)/.test(body),
    );

    expect(usesBase, "expected body to use var(--font-display)").toBe(true);
  });

  it("never pins an element back to a Helvetica-first stack", () => {
    // Body copy must inherit the D-DIN base; Helvetica/Arial may only appear as
    // the fallback inside --font-display, never as a primary font-family.
    const helveticaPins = css.match(/font-family:\s*"Helvetica Neue"/g) ?? [];

    expect(helveticaPins).toHaveLength(0);
  });
});
