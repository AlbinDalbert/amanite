import { describe, expect, it } from "vitest";
import type { FractalLoadedPage } from "@/lib/fractal/types";
import { bufferFromLoadedPage } from "./documentBuffers";

describe("native document buffers", () => {
  it("keeps live title and body out of the workspace buffer", () => {
    const loaded: FractalLoadedPage = {
      path: "notes.fractal.html",
      source: "<html><head><title>Notes</title></head><body><main data-fractal-document><p>Before</p></main></body></html>",
      links: [],
      backlinks: [],
      contentHash: "sha256:native",
      nativeDocumentParts: {
        title: "Notes",
        titleHash: "title",
        contentHtml: "<p>Before</p>",
        contentHash: "content",
        styleCss: "",
        styleHash: "style",
        metadataHtml: "",
        metadataHash: "metadata",
        sourceHash: "source"
      }
    };

    const buffer = bufferFromLoadedPage(loaded);
    expect(buffer).not.toHaveProperty("source");
    expect(buffer).not.toHaveProperty("bodyHtml");
    expect(buffer).not.toHaveProperty("title");
    expect(buffer).toMatchObject({ compatibilityIssues: [], nativeDocumentParts: loaded.nativeDocumentParts });
  });

  it("keeps exact source when Fractal cannot expose editable sections", () => {
    const source = "<!doctype html><html><body><main data-fractal-document><p>Broken but recoverable</p></main></body></html>";
    const loaded: FractalLoadedPage = {
      path: "broken.fractal.html",
      source,
      links: [],
      backlinks: [],
      contentHash: "sha256:broken",
      nativeDocumentParts: null
    };

    expect(bufferFromLoadedPage(loaded)).toMatchObject({
      protectedSource: source,
      nativeDocumentParts: null,
      dirty: false
    });
  });
});
