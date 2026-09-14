import { $createHeadingNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { createAmaniteEditor } from "./editorConfig";
import { countTextMatchesInText, readEditorModel } from "./editorModel";

describe("editor model queries", () => {
  it("reads counts and outline from the live Lexical model", async () => {
    const editor = createAmaniteEditor("editor-model-test");
    editor.update(() => {
      const heading = $createHeadingNode("h2");
      heading.append($createTextNode("Unicode café"));
      const paragraph = $createParagraphNode();
      paragraph.append($createTextNode("First paragraph."));
      const list = $createListNode("bullet");
      const item = $createListItemNode();
      item.append($createTextNode("A list item"));
      list.append(item);
      $getRoot().clear().append(heading, paragraph, list);
    });

    await vi.waitFor(() => expect(readEditorModel(editor.getEditorState(), 7).text).toContain("Unicode café"));
    expect(readEditorModel(editor.getEditorState(), 7)).toEqual({
      counts: { characters: 41, paragraphs: 2, readingMinutes: 1, words: 7 },
      outline: [{ index: 0, label: "Unicode café", level: 2 }],
      revision: 7,
      text: "Unicode café First paragraph. A list item"
    });
  });

  it("matches Unicode text without rebuilding native source", () => {
    expect(countTextMatchesInText("Ångström ångström ANGSTROM", "ångström")).toBe(2);
    expect(countTextMatchesInText("one one", "one")).toBe(2);
  });
});
