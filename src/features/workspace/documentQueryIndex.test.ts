import { describe, expect, it } from "vitest";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";
import type { FractalPage } from "@/lib/fractal/types";
import { DocumentQueryIndex } from "./documentQueryIndex";

function page(path: string, title: string, text: string): FractalPage {
  return { contentHash: `${path}:hash`, links: [], path, text, title };
}

function model(text: string, revision: number): EditorModelSnapshot {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return {
    counts: { characters: text.length, paragraphs: 2, readingMinutes: words ? 1 : 0, words },
    outline: [{ index: 0, label: "Heading", level: 2 }],
    revision,
    text
  };
}

describe("DocumentQueryIndex", () => {
  it("overlays live model text and title while retaining saved fallback", () => {
    const index = new DocumentQueryIndex([
      page("one.fractal.html", "One", "saved one"),
      page("two.fractal.html", "Two", "saved two")
    ]);

    index.setLiveDocument({
      documentId: "document-one",
      dirty: true,
      links: [],
      model: model("live unsaved one", 7),
      path: "one.fractal.html",
      title: "Live One"
    });

    expect(index.getDocument("one.fractal.html")).toMatchObject({
      freshness: "live",
      revision: 7,
      text: "live unsaved one",
      title: "Live One"
    });
    expect(index.getDocument("two.fractal.html")).toMatchObject({ freshness: "saved", text: "saved two", revision: 0 });
    expect(index.search("unsaved")).toEqual([expect.objectContaining({ freshness: "live", path: "one.fractal.html", revision: 7 })]);
  });

  it("bounds text reads without parsing the source again", () => {
    const index = new DocumentQueryIndex([page("one.fractal.html", "One", "0123456789")]);
    const result = index.readText("one.fractal.html", 3, 4);

    expect(result).toMatchObject({ content: "3456", nextOffset: 7, offset: 3, text: "0123456789" });
  });

  it("leaves the title index stable for body-only catalog updates", () => {
    const index = new DocumentQueryIndex([page("one.fractal.html", "One", "old")]);
    const rebuilds = index.titleIndex.rebuildCount;

    index.updateCatalog([page("one.fractal.html", "One", "new")]);

    expect(index.titleIndex.rebuildCount).toBe(rebuilds);
    expect(index.getDocument("one.fractal.html")?.text).toBe("new");
  });

  it("restores the saved query after a live session is removed", () => {
    const index = new DocumentQueryIndex([page("one.fractal.html", "One", "saved")]);
    index.setLiveDocument({ documentId: "document-one", dirty: true, links: [], model: model("live", 2), path: "one.fractal.html", title: "Live" });

    index.syncLiveDocuments([]);

    expect(index.getDocument("one.fractal.html")).toMatchObject({ freshness: "saved", text: "saved", title: "One", revision: 0 });
  });
});
