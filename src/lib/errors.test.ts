import { describe, expect, it } from "vitest";

import { messageFromReason } from "./errors";

describe("messageFromReason", () => {
  it("returns the string verbatim when reason is a string", () => {
    expect(messageFromReason("network timeout")).toBe("network timeout");
  });

  it("returns the Error message when reason is an Error", () => {
    expect(messageFromReason(new Error("file not found"))).toBe(
      "file not found",
    );
  });

  it("returns the default fallback when reason is a plain object", () => {
    expect(messageFromReason({})).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("returns the default fallback when reason is a number", () => {
    expect(messageFromReason(42)).toBe(
      "Something went wrong. Please try again.",
    );
  });

  it("returns a custom fallback when reason is non-string/non-Error and fallback is provided", () => {
    expect(messageFromReason({}, "Custom error message.")).toBe(
      "Custom error message.",
    );
  });
});
