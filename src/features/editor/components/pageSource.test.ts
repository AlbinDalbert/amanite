import { describe, expect, it } from "vitest";
import { analyzeEditablePage, readEditablePage, writeEditableBody, writeEditableTitle } from "./pageSource";

const SOURCE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>Field Notes</title><style data-fractal-style></style></head><body><main data-fractal-document><h1 data-fractal-title>Field Notes</h1><p>First paragraph.</p></main></body></html>`;

describe("native page source bridge", () => {
  it("separates the mirrored title heading from the editable body", () => {
    expect(readEditablePage(SOURCE)).toEqual({ bodyHtml: "<p>First paragraph.</p>", hasTitleHeading: true, title: "Field Notes" });
  });

  it("derives the editor view, outline, and counts in one analysis", () => {
    const source = SOURCE.replace("</main>", "<h2>Weather</h2><p>Cold and clear.</p></main>");
    const analysis = analyzeEditablePage(source);
    expect(analysis.page).toEqual({
      bodyHtml: "<p>First paragraph.</p><h2>Weather</h2><p>Cold and clear.</p>",
      hasTitleHeading: true,
      title: "Field Notes"
    });
    expect(analysis.outline).toEqual([{ index: 0, label: "Weather", level: 2 }]);
    expect(analysis.counts).toMatchObject({ paragraphs: 2, words: 6 });
    expect(analysis.inspection).toEqual({ compatibilityIssues: [] });
  });

  it("writes body changes back into the complete document", () => {
    const next = writeEditableBody(SOURCE, "<p>Revised.</p>", true);
    expect(next).toContain("<title>Field Notes</title>");
    expect(next).toContain('<h1 data-fractal-title="">Field Notes</h1><p>Revised.</p>');
    expect(next).toContain('meta name="fractal-format"');
  });

  it("updates both title locations", () => {
    const next = writeEditableTitle(SOURCE, "Revised Notes", true);
    expect(next).toContain("<title>Revised Notes</title>");
    expect(next).toContain('<h1 data-fractal-title="">Revised Notes</h1>');
  });

  it("protects attributes that rich editing cannot round trip", () => {
    const source = SOURCE.replace("<p>", '<p class="lead">');
    expect(analyzeEditablePage(source).inspection).toEqual({ compatibilityIssues: ["<p> class"] });
  });
});
