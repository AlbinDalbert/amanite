import { describe, expect, it } from "vitest";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";
import type { FractalPage } from "@/lib/fractal/types";
import { DocumentQueryIndex } from "./documentQueryIndex";

function page(path: string, title: string): FractalPage {
  return { contentHash: `${path}:hash`, path, title };
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
  function withSaved(path: string, title: string, text: string) {
    const index = new DocumentQueryIndex([page(path, title)]);
    index.setSavedDocument({ counts: model(text, 0).counts, links: [], outline: [], path, text, title });
    return index;
  }

  it("overlays live model text and title while retaining saved fallback", async () => {
    const index = new DocumentQueryIndex([
      page("one.fractal.html", "One"),
      page("two.fractal.html", "Two")
    ]);
    index.setSavedDocument({ counts: model("saved two", 0).counts, links: [], outline: [], path: "two.fractal.html", text: "saved two", title: "Two" });

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
    await expect(index.search("unsaved")).resolves.toEqual([expect.objectContaining({ freshness: "live", path: "one.fractal.html", revision: 7 })]);
  });

  it("bounds text reads without parsing the source again", () => {
    const index = withSaved("one.fractal.html", "One", "0123456789");
    const result = index.readText("one.fractal.html", 3, 4);

    expect(result).toMatchObject({ content: "3456", nextOffset: 7, offset: 3, text: "0123456789" });
  });

  it("leaves the title index stable when saved content changes", () => {
    const index = withSaved("one.fractal.html", "One", "old");
    const rebuilds = index.titleIndex.rebuildCount;

    index.setSavedDocument({ counts: model("new", 0).counts, links: [], outline: [], path: "one.fractal.html", text: "new", title: "One" });

    expect(index.titleIndex.rebuildCount).toBe(rebuilds);
    expect(index.getDocument("one.fractal.html")?.text).toBe("new");
  });

  it("restores the saved query after a live session is removed", () => {
    const index = withSaved("one.fractal.html", "One", "saved");
    index.setLiveDocument({ documentId: "document-one", dirty: true, links: [], model: model("live", 2), path: "one.fractal.html", title: "Live" });

    index.syncLiveDocuments([]);

    expect(index.getDocument("one.fractal.html")).toMatchObject({ freshness: "saved", text: "saved", title: "One", revision: 0 });
  });

  it("overlays live results and rejects stale saved search results", async () => {
    const savedSearch = async () => [
      { catalogVersion: 3, sessionGeneration: 9, path: "one.fractal.html", snippet: "stale saved", title: "One" },
      { catalogVersion: 4, sessionGeneration: 9, path: "two.fractal.html", snippet: "current saved", title: "Two" }
    ];
    const index = new DocumentQueryIndex([page("one.fractal.html", "One"), page("two.fractal.html", "Two")], savedSearch);
    index.updateCatalog([page("one.fractal.html", "One"), page("two.fractal.html", "Two")], 4, 9);
    index.setLiveDocument({ documentId: "one", dirty: true, links: [], model: model("live needle", 5), path: "one.fractal.html", title: "One" });

    await expect(index.search("needle")).resolves.toEqual([
      expect.objectContaining({ freshness: "live", path: "one.fractal.html", revision: 5 }),
      expect.objectContaining({ catalogVersion: 4, path: "two.fractal.html" })
    ]);
  });
});
