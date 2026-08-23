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
});
