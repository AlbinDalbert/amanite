import { describe, expect, it } from "vitest";
import type { FractalPage } from "@/lib/fractal/types";
import { buildExplorerTree, compareExplorerEntries } from "./FileExplorer";

function page(path: string, kind: FractalPage["kind"]) {
  return { kind: "page" as const, path, page: { kind, path } as FractalPage };
}

describe("file explorer ordering", () => {
  it("sorts folders, native pages, then every other page alphabetically", () => {
    const entries = [
      page("zeta.txt", "raw"),
      page("alpha.fractal.html", "native"),
      { kind: "folder" as const, path: "Zoo", children: [] },
      page("beta.md", "raw"),
      { kind: "folder" as const, path: "archive", children: [] },
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
      ["Characters", "Stories"],
      [page("Characters/Vivian.fractal.html", "native").page, page("Stories/Animal Machines.fractal.html", "native").page, page("root.html", "raw").page]
    );
    const characters = tree.find((entry) => entry.kind === "folder" && entry.path === "Characters");
    const stories = tree.find((entry) => entry.kind === "folder" && entry.path === "Stories");
    expect(characters?.kind === "folder" ? characters.children.map((entry) => entry.path) : []).toEqual(["Characters/Vivian.fractal.html"]);
    expect(stories?.kind === "folder" ? stories.children.map((entry) => entry.path) : []).toEqual(["Stories/Animal Machines.fractal.html"]);
    expect(tree.map((entry) => entry.path)).toEqual(["Characters", "Stories", "root.html"]);
  });
});
