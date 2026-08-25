import { describe, expect, it } from "vitest";
import { inspectEditablePage, readEditablePage, writeEditableBody, writeEditableTitle } from "./pageSource";

const SOURCE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="fractal-format" content="1"><title>Field Notes</title></head><body><main data-fractal-document><h1>Field Notes</h1><p>First paragraph.</p></main></body></html>`;

describe("native page source bridge", () => {
  it("separates the mirrored title heading from the editable body", () => {
    expect(readEditablePage(SOURCE)).toEqual({ bodyHtml: "<p>First paragraph.</p>", hasTitleHeading: true, title: "Field Notes" });
  });

  it("writes body changes back into the complete document", () => {
    const next = writeEditableBody(SOURCE, "<p>Revised.</p>", true);
    expect(next).toContain("<title>Field Notes</title>");
    expect(next).toContain("<h1>Field Notes</h1><p>Revised.</p>");
    expect(next).toContain('meta name="fractal-format"');
  });

  it("updates both title locations", () => {
    const next = writeEditableTitle(SOURCE, "Revised Notes", true);
    expect(next).toContain("<title>Revised Notes</title>");
    expect(next).toContain("<h1>Revised Notes</h1>");
  });

  it("blocks malformed native documents instead of handing them to the editor", () => {
    const inspection = inspectEditablePage("<html><body><p>Loose content</p></body></html>");
    expect(inspection.structuralIssues).toEqual(expect.arrayContaining([
      "The HTML doctype is missing.",
      "The Fractal format marker is missing.",
      "The document needs exactly one Fractal document root.",
      "Elements outside the document root: <p>."
    ]));
  });

  it("protects attributes that rich editing cannot round trip", () => {
    const source = SOURCE.replace("<p>", '<p class="lead">');
    expect(inspectEditablePage(source)).toEqual({
      compatibilityIssues: ["<p> class"],
      structuralIssues: []
    });
  });
});
