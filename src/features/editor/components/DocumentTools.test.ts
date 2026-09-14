import { $createLinkNode } from "@lexical/link";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { countDocument, countTextMatches, replaceDocumentText, replaceEditorText } from "./DocumentTools";
import { createAmaniteEditor } from "./editorConfig";

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

  it("replaces the live model while leaving explicit links unchanged", async () => {
    const editor = createAmaniteEditor("document-tools-editor-test");
    editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("One two "));
      const link = $createLinkNode("two.html");
      link.append($createTextNode("two linked"));
      paragraph.append(link);
      $getRoot().clear().append(paragraph);
    });
    await vi.waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toContain("One two"));

    expect(replaceEditorText(editor, "two", "four")).toBe(true);
    await vi.waitFor(() => expect(editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("One four two linked"));
  });
});
