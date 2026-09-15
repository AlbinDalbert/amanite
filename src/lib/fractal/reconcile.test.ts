import { describe, expect, it } from "vitest";
import { applyProjectUpdate, createdPagePath, mapFolderPath, mapPagePath, mutationScope, pagePathFromProjectPath, reconcileMutationResult, receiptMappings } from "./reconcile";
import type { FractalMutationResult, FractalProject } from "./types";

function project(pages: FractalProject["pages"] = []): FractalProject {
  return {
    name: "Notes",
    version: 2,
    rootPath: "/tmp/notes",
    pages,
    folders: [],
    activePagePath: null,
    activePageSource: null,
    activePageLinks: [],
    activePageBacklinks: [],
    activePageContentHash: null,
    activePageNativeDocumentParts: null
  };
}

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

  it("composes direct and folder moves and records every affected entry", () => {
    const receipt = {
      operation: "move_page" as const,
      warnings: [],
      changes: [
        { change: "moved" as const, from: "pages/old/page.fractal.html", to: "pages/notes/page.fractal.html", entry: "file" as const },
        { change: "moved" as const, from: "pages/notes", to: "pages/archive", entry: "directory" as const },
        { change: "created" as const, path: "pages/archive/new.fractal.html", entry: "file" as const },
        { change: "updated" as const, path: "pages/archive/linked.fractal.html", before_hash: "a", after_hash: "b" },
        { change: "deleted" as const, path: "pages/old/deleted.fractal.html", entry: "file" as const }
      ]
    };
    const mappings = receiptMappings(receipt);
    const scope = mutationScope(receipt);

    expect(mapPagePath("old/page.fractal.html", mappings)).toBe("archive/page.fractal.html");
    expect(mapFolderPath("notes", mappings)).toBe("archive");
    expect(scope.affectedPages).toEqual(new Set([
      "archive/new.fractal.html",
      "archive/linked.fractal.html",
      "old/deleted.fractal.html",
      "old/page.fractal.html",
      "notes/page.fractal.html"
    ]));
    expect(scope.requiresConservativeBarrier).toBe(true);
  });

  it("reuses unchanged catalog entries while publishing receipt changes", () => {
    const unchanged = { path: "same.fractal.html", contentHash: "same", title: "Same", text: "Same", links: [] };
    const current = project([unchanged, { path: "old.fractal.html", contentHash: "old", title: "Old", text: "Old", links: [] }]);
    const next = project([unchanged, { path: "new.fractal.html", contentHash: "new", title: "New", text: "New", links: [] }]);
    const mutation: FractalMutationResult = {
      project: next,
      receipt: {
        operation: "set_page_title",
        warnings: [],
        changes: [{ change: "moved", from: "pages/old.fractal.html", to: "pages/new.fractal.html", entry: "file" }]
      }
    };

    const reconciled = reconcileMutationResult(current, mutation);
    expect(reconciled.result.project.pages[0]).toBe(unchanged);
    expect(reconciled.result.project.pages[1]).toBe(next.pages[1]);
    expect(reconciled.scope.mappings.pages.get("old.fractal.html")).toBe("new.fractal.html");
  });

  it("applies a compact update without replacing unrelated catalog entries", () => {
    const untouched = { path: "same.fractal.html", contentHash: "same", title: "Same" };
    const current = project([untouched, { path: "old.fractal.html", contentHash: "old", title: "Old" }]);
    const update = { ...project([{ path: "new.fractal.html", contentHash: "new", title: "New" }]), catalogVersion: 2 };
    const receipt = {
      operation: "set_page_title" as const,
      warnings: [],
      changes: [{ change: "moved" as const, from: "pages/old.fractal.html", to: "pages/new.fractal.html", entry: "file" as const }]
    };

    const result = applyProjectUpdate(current, update, [receipt]);
    expect(result.pages.find((page) => page.path === "same.fractal.html")).toBe(untouched);
    expect(result.pages.find((page) => page.path === "old.fractal.html")).toBeUndefined();
    expect(result.pages.find((page) => page.path === "new.fractal.html")?.title).toBe("New");
  });
});
