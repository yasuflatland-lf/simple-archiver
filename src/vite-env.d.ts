/// <reference types="vite/client" />

// Fontsource packages resolve to CSS and ship no type declarations.
// TypeScript 6.0 reports TS2882 for such side-effect imports without an ambient module.
declare module "@fontsource-variable/*";
