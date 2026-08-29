import { describe, expect, it } from "vitest";
import { folderChildPath, shouldOpenFolderChild } from "./FolderView";

describe("folder view actions", () => {
  it("creates child paths inside root and nested folders", () => {
    expect(folderChildPath("", "Drafts")).toBe("Drafts");
    expect(folderChildPath("book/part-one", "Drafts")).toBe("book/part-one/Drafts");
  });

  it("opens a card on double-click unless the click came from a control or editor", () => {
    const card = document.createElement("article");
    const heading = document.createElement("h2");
    const button = document.createElement("button");
    const editor = document.createElement("div");
    editor.setAttribute("contenteditable", "true");
    card.append(heading, button, editor);

    expect(shouldOpenFolderChild(heading)).toBe(true);
    expect(shouldOpenFolderChild(button)).toBe(false);
    expect(shouldOpenFolderChild(editor)).toBe(false);
  });
});
