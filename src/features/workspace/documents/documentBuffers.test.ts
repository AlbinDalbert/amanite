import { describe, expect, it } from "vitest";
import type { FractalLoadedPage } from "@/lib/fractal/types";
import { bufferFromLoadedPage } from "./documentBuffers";

describe("native document buffers", () => {
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
      source,
      nativeDocumentParts: null,
      dirty: false
    });
  });
});
