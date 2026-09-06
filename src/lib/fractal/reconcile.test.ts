import { describe, expect, it } from "vitest";
import { createdPagePath, mapPagePath, pagePathFromProjectPath, receiptMappings } from "./reconcile";

describe("receipt reconciliation", () => {
  it("normalizes project paths and finds the created native file instead of the first entry", () => {
    const receipt = { operation: "create_page" as const, warnings: [], changes: [
      { change: "updated" as const, path: "pages/.fractal-folder.json", before_hash: "a", after_hash: "b" },
      { change: "created" as const, path: "pages/book/one.fractal.html", entry: "file" as const }
    ] };
    expect(pagePathFromProjectPath("/pages/book/one.fractal.html")).toBe("book/one.fractal.html");
    expect(createdPagePath(receipt)).toBe("book/one.fractal.html");
  });

  it("maps nested pages through a moved directory", () => {
    const mappings = receiptMappings({ operation: "set_folder_title", warnings: [], changes: [
      { change: "moved", from: "pages/old", to: "pages/new", entry: "directory" }
    ] });
    expect(mapPagePath("old/nested/page.fractal.html", mappings)).toBe("new/nested/page.fractal.html");
  });

  it("leaves state unchanged for a no-op receipt", () => {
    const mappings = receiptMappings({ operation: "move_page", warnings: [], changes: [] });
    expect(mapPagePath("one.fractal.html", mappings)).toBe("one.fractal.html");
    expect(mappings.rewrittenPages.size).toBe(0);
  });
});
