// Testing Library: unmount React trees after each test to isolate cases.

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
