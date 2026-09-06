import { describe, expect, it } from "vitest";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import { buildExplorerTree, compareExplorerEntries } from "./FileExplorer";

function page(path: string) {
  return { kind: "page" as const, path, page: { contentHash: path, links: [], path, text: "" } as FractalPage };
}

function folder(path: string, title = path || "Project", children: FractalFolder["children"] = []): FractalFolder {
  return { children, issues: [], order: null, path, title };
}

describe("file explorer ordering", () => {
  it("sorts folders before native pages", () => {
    const entries = [
      page("alpha.fractal.html"),
      { kind: "folder" as const, path: "Zoo", folder: folder("Zoo"), children: [] },
      { kind: "folder" as const, path: "archive", folder: folder("archive"), children: [] },
      page("zulu.fractal.html")
    ];

    expect(entries.sort(compareExplorerEntries).map((entry) => entry.path)).toEqual([
      "archive",
      "Zoo",
      "alpha.fractal.html",
      "zulu.fractal.html"
    ]);
  });

  it("nests each page under its actual parent folder", () => {
    const tree = buildExplorerTree(
      [
        folder("", "Project", [{ kind: "folder", name: "Characters", status: "present" }, { kind: "folder", name: "Stories", status: "present" }]),
        folder("Characters", "Characters", [{ kind: "native", name: "Vivian.fractal.html", status: "present" }]),
        folder("Stories", "Stories", [{ kind: "native", name: "Animal Machines.fractal.html", status: "present" }])
      ],
      [page("Characters/Vivian.fractal.html").page, page("Stories/Animal Machines.fractal.html").page]
    );
    const characters = tree.find((entry) => entry.kind === "folder" && entry.path === "Characters");
    const stories = tree.find((entry) => entry.kind === "folder" && entry.path === "Stories");
    expect(characters?.kind === "folder" ? characters.children.map((entry) => entry.path) : []).toEqual(["Characters/Vivian.fractal.html"]);
    expect(stories?.kind === "folder" ? stories.children.map((entry) => entry.path) : []).toEqual(["Stories/Animal Machines.fractal.html"]);
    expect(tree.map((entry) => entry.path)).toEqual(["Characters", "Stories"]);
  });

  it("uses Fractal's effective child order", () => {
    const tree = buildExplorerTree(
      [
        folder("", "Project", [{ kind: "native", name: "last.fractal.html", status: "present" }, { kind: "folder", name: "First", status: "present" }]),
        folder("First")
      ],
      [page("last.fractal.html").page]
    );

    expect(tree.map((entry) => entry.path)).toEqual(["last.fractal.html", "First"]);
  });
});
