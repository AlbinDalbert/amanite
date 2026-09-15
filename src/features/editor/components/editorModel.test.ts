import { $createHeadingNode } from "@lexical/rich-text";
import { $createListItemNode, $createListNode } from "@lexical/list";
import { $createParagraphNode, $createTextNode, $getRoot, $isTextNode } from "lexical";
import { describe, expect, it, vi } from "vitest";
import { createAmaniteEditor } from "./editorConfig";
import { countTextMatchesInText, DerivedEditorModel, readEditorModel } from "./editorModel";

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

  it("updates cached block counts from Lexical dirty nodes", async () => {
    const editor = createAmaniteEditor("derived-editor-model-test");
    editor.update(() => {
      const first = $createParagraphNode();
      first.append($createTextNode("One two"));
      const second = $createParagraphNode();
      second.append($createTextNode("Three"));
      $getRoot().clear().append(first, second);
    }, { discrete: true });
    const service = new DerivedEditorModel();
    expect(service.update(editor.getEditorState(), 1)).toMatchObject({ counts: { characters: 13, paragraphs: 2, words: 3 }, text: "One two Three" });

    const updated = new Promise<ReturnType<DerivedEditorModel["update"]>>((resolve) => {
      const unregister = editor.registerUpdateListener(({ dirtyElements, dirtyLeaves, editorState }) => {
        unregister();
        resolve(service.update(editorState, 2, dirtyElements, dirtyLeaves));
      });
    });
    editor.update(() => {
      const text = $getRoot().getLastDescendant();
      if ($isTextNode(text)) text.setTextContent("Three four");
    });
    await expect(updated).resolves.toMatchObject({ counts: { characters: 18, paragraphs: 2, words: 4 }, text: "One two Three four" });
  });
});
