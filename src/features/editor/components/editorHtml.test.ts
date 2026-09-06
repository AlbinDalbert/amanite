import { describe, expect, it } from "vitest";
import { cleanEditorHtml, richEditorCompatibilityIssues } from "./editorHtml";

describe("rich editor HTML contract", () => {
  it("reports markup that the rich editor cannot round trip", () => {
    expect(richEditorCompatibilityIssues('<section class="chapter"><p id="start">Text</p></section>')).toEqual([
      "<section>",
      "<section> class",
      "<p> id"
    ]);
  });

  it("keeps supported semantic content and removes unsupported wrappers", () => {
    expect(cleanEditorHtml('<section><p class="lead">Text <strong>here</strong>.</p></section>')).toBe("<p>Text <strong>here</strong>.</p>");
  });

  it("rejects media before Lexical can drop or transform it", () => {
    expect(richEditorCompatibilityIssues('<img src="field.png"><iframe src="map.html"></iframe>')).toEqual([
      "<img>",
      "<img> src",
      "<iframe>",
      "<iframe> src"
    ]);
  });

  it("protects semantic metadata that Lexical drops during import", () => {
    expect(richEditorCompatibilityIssues('<table><caption>Important</caption><tbody><tr><td>Cell</td></tr></tbody></table>')).toEqual([
      "<caption>"
    ]);
    expect(richEditorCompatibilityIssues('<p><time datetime="2026-09-06">Sunday</time></p>')).toEqual([
      "<time>",
      "<time> datetime"
    ]);
  });
});
