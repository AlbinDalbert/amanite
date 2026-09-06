import { describe, expect, it } from "vitest";
import type { FractalMutationResult } from "./types";

describe("Fractal mutation wire contract", () => {
  it("uses camelCase for the Amanite snapshot and Fractal's receipt field names", () => {
    const result = {
      project: {
        name: "Notes",
        version: 2,
        rootPath: "/projects/notes",
        pages: [],
        folders: [],
        activePagePath: "first.fractal.html",
        activePageSource: null,
        activePageLinks: [],
        activePageBacklinks: [],
        activePageContentHash: null,
        activePageNativeDocumentParts: null
      },
      receipt: {
        operation: "create_page",
        changes: [{
          change: "created",
          path: "pages/first.fractal.html",
          entry: "file",
          after_hash: "sha256:created"
        }],
        warnings: []
      }
    } satisfies FractalMutationResult;

    expect(JSON.parse(JSON.stringify(result))).toMatchObject({
      project: { activePagePath: "first.fractal.html", rootPath: "/projects/notes" },
      receipt: {
        operation: "create_page",
        changes: [{ after_hash: "sha256:created", change: "created", entry: "file" }]
      }
    });
  });
});
