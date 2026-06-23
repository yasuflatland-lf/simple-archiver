import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// GitHub Project Pages are served from /<repo>/, so emitted asset URLs must be
// prefixed with that base or they 404 on the published subpath.
export default defineConfig({
  base: "/simple-archiver/",
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
