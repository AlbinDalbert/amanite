import { describe, expect, it } from "vitest";
import { countDocument, countTextMatches, replaceDocumentText } from "./DocumentTools";

const SOURCE = '<!doctype html><html><head><title>Notes</title></head><body><main data-fractal-document><p>One two three.</p><p>Two more words and <a href="two.html">two linked</a>.</p></main></body></html>';

describe("document tools", () => {
  it("counts visible document text", () => {
    expect(countDocument(SOURCE, true)).toMatchObject({ paragraphs: 2, words: 9 });
    expect(countTextMatches(SOURCE, "two", true)).toBe(3);
  });

  it("replaces prose without rewriting explicit link text", () => {
    const next = replaceDocumentText(SOURCE, "two", "four", true);
    expect(next).toContain("One four three.");
    expect(next).toContain('<a href="two.html">two linked</a>');
  });
});
