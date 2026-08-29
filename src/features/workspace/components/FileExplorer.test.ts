import { describe, expect, it } from "vitest";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import { buildExplorerTree, compareExplorerEntries } from "./FileExplorer";

function page(path: string, kind: FractalPage["kind"]) {
  return { kind: "page" as const, path, page: { kind, path } as FractalPage };
}

function folder(path: string, title = path || "Project", children: FractalFolder["children"] = []): FractalFolder {
  return { children, issues: [], order: null, path, title };
}

describe("file explorer ordering", () => {
  it("sorts folders, native pages, then every other page alphabetically", () => {
    const entries = [
      page("zeta.txt", "raw"),
      page("alpha.fractal.html", "native"),
      { kind: "folder" as const, path: "Zoo", folder: folder("Zoo"), children: [] },
      page("beta.md", "raw"),
      { kind: "folder" as const, path: "archive", folder: folder("archive"), children: [] },
      page("zulu.fractal.html", "native"),
      page("alpha.html", "raw")
    ];

    expect(entries.sort(compareExplorerEntries).map((entry) => entry.path)).toEqual([
      "archive",
      "Zoo",
      "alpha.fractal.html",
      "zulu.fractal.html",
      "alpha.html",
      "beta.md",
      "zeta.txt"
    ]);
  });

  it("nests each page under its actual parent folder", () => {
    const tree = buildExplorerTree(
      [
        folder("", "Project", [{ kind: "folder", name: "Characters", status: "present" }, { kind: "folder", name: "Stories", status: "present" }]),
        folder("Characters", "Characters", [{ kind: "native", name: "Vivian.fractal.html", status: "present" }]),
        folder("Stories", "Stories", [{ kind: "native", name: "Animal Machines.fractal.html", status: "present" }])
      ],
      [page("Characters/Vivian.fractal.html", "native").page, page("Stories/Animal Machines.fractal.html", "native").page, page("root.html", "raw").page]
    );
    const characters = tree.find((entry) => entry.kind === "folder" && entry.path === "Characters");
    const stories = tree.find((entry) => entry.kind === "folder" && entry.path === "Stories");
    expect(characters?.kind === "folder" ? characters.children.map((entry) => entry.path) : []).toEqual(["Characters/Vivian.fractal.html"]);
    expect(stories?.kind === "folder" ? stories.children.map((entry) => entry.path) : []).toEqual(["Stories/Animal Machines.fractal.html"]);
    expect(tree.map((entry) => entry.path)).toEqual(["Characters", "Stories", "root.html"]);
  });

  it("uses Fractal's effective child order", () => {
    const tree = buildExplorerTree(
      [
        folder("", "Project", [{ kind: "native", name: "last.fractal.html", status: "present" }, { kind: "folder", name: "First", status: "present" }]),
        folder("First")
      ],
      [page("last.fractal.html", "native").page]
    );

    expect(tree.map((entry) => entry.path)).toEqual(["last.fractal.html", "First"]);
  });
});
