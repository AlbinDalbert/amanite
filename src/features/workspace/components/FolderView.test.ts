import { describe, expect, it } from "vitest";
import { buildFolderFindGroups, directParent, folderChildPath, shouldOpenFolderChild } from "./FolderView";
import type { FolderExportNode } from "./FolderExportDialog";

describe("folder view actions", () => {
  it("creates child paths inside root and nested folders", () => {
    expect(folderChildPath("", "Drafts")).toBe("Drafts");
    expect(folderChildPath("book/part-one", "Drafts")).toBe("book/part-one/Drafts");
  });

  it("moves one level toward the Pages root", () => {
    expect(directParent("stories/characters")).toBe("stories");
    expect(directParent("stories")).toBe("");
    expect(directParent("")).toBe("");
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

describe("folder find", () => {
  it("keeps export tree order and groups matches by folder", () => {
    const nodes: FolderExportNode[] = [
      { kind: "page", projectPath: "first.fractal.html", relativePath: "first.fractal.html", title: "First", children: [] },
      { kind: "folder", projectPath: "notes", relativePath: "notes", title: "Notes", children: [{ kind: "page", projectPath: "notes/second.fractal.html", relativePath: "notes/second.fractal.html", title: "Second", children: [] }] }
    ];
    const pages = [
      { path: "first.fractal.html", title: "First", text: "needle once", kind: "native" as const, contentHash: "a", links: [], iframes: [] },
      { path: "notes/second.fractal.html", title: "Second", text: "needle and needle", kind: "native" as const, contentHash: "b", links: [], iframes: [] }
    ];
    const groups = buildFolderFindGroups(nodes, pages, "needle", "Pages", "");
    expect(groups.map((group) => group.title)).toEqual(["Pages", "Notes"]);
    expect(groups.flatMap((group) => group.pages).map((page) => page.path)).toEqual(["first.fractal.html", "notes/second.fractal.html"]);
    expect(groups[1].pages[0].matches).toHaveLength(2);
  });
});
