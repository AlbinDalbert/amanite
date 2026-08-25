import { describe, expect, it } from "vitest";
import { safeExternalHref } from "./linkNavigation";

describe("external editor links", () => {
  it("allows ordinary web and mail links", () => {
    expect(safeExternalHref("https://example.com/notes")).toBe("https://example.com/notes");
    expect(safeExternalHref("mailto:notes@example.com")).toBe("mailto:notes@example.com");
  });

  it("rejects active and local URL schemes", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("file:///tmp/private.txt")).toBeNull();
    expect(safeExternalHref("data:text/html,hello")).toBeNull();
  });
});
