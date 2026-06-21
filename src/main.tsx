import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/inter";

import { ThemeProvider } from "@/components/theme-provider";

import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
