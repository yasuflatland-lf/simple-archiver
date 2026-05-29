// Testing Library: unmount React trees after each test to isolate cases.
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
