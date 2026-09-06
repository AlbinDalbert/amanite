import { describe, expect, it } from "vitest";
import { safeExternalHref } from "./linkNavigation";

describe("external editor links", () => {
  it("allows the external schemes Fractal accepts", () => {
    expect(safeExternalHref("https://example.com/notes")).toBe("https://example.com/notes");
    expect(safeExternalHref("mailto:notes@example.com")).toBe("mailto:notes@example.com");
    expect(safeExternalHref("tel:+4600000000")).toBe("tel:+4600000000");
  });

  it("rejects active and local URL schemes", () => {
    expect(safeExternalHref("javascript:alert(1)")).toBeNull();
    expect(safeExternalHref("file:///tmp/private.txt")).toBeNull();
    expect(safeExternalHref("data:text/html,hello")).toBeNull();
    expect(safeExternalHref("missing.fractal.html")).toBeNull();
  });
});
