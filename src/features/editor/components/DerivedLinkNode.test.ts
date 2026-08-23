import { $generateHtmlFromNodes } from "@lexical/html";
import { $createParagraphNode, $getRoot, createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { $createDerivedLinkNode, DerivedLinkNode } from "./DerivedLinkNode";

describe("derived link persistence", () => {
  it("renders link behavior without exporting an anchor", () => {
    const editor = createEditor({
      namespace: "derived-link-test",
      nodes: [DerivedLinkNode],
      onError(error) { throw error; }
    });
    const editorElement = document.createElement("div");
    editor.setRootElement(editorElement);
    editor.update(() => {
      const paragraph = $createParagraphNode();
      paragraph.append($createDerivedLinkNode("Index", "index.fractal.html", "notes.fractal.html"));
      $getRoot().append(paragraph);
    }, { discrete: true });

    const derived = editorElement.querySelector<HTMLElement>(".rich-derived-link");
    expect(derived?.tagName).toBe("SPAN");
    expect(derived?.getAttribute("role")).toBe("link");
    expect(derived?.hasAttribute("href")).toBe(false);

    const html = editor.getEditorState().read(() => $generateHtmlFromNodes(editor), { editor });
    const exported = new DOMParser().parseFromString(html, "text/html");
    expect(exported.body.textContent).toBe("Index");
    expect(exported.body.querySelector("a")).toBeNull();
  });
});
