import { describe, expect, it } from "vitest";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import { buildFolderExportTree, pagePathsIn } from "./FolderExportDialog";

function folder(path: string, title: string, children: FractalFolder["children"]): FractalFolder {
  return { children, issues: [], order: null, path, title };
}

function page(path: string, title: string, kind: FractalPage["kind"] = "native"): FractalPage {
  return { contentHash: path, iframes: [], kind, links: [], path, text: "", title };
}

describe("folder export tree", () => {
  it("keeps Fractal's recursive effective order and uses paths relative to the exported folder", () => {
    const tree = buildFolderExportTree(
      folder("book", "Book", [
        { kind: "native", name: "opening.fractal.html", status: "present" },
        { kind: "folder", name: "part-one", status: "present" },
        { kind: "native", name: "ghost.fractal.html", status: "missing" }
      ]),
      [
        folder("book/part-one", "Part one", [
          { kind: "native", name: "second.fractal.html", status: "present" },
          { kind: "native", name: "first.fractal.html", status: "present" }
        ])
      ],
      [
        page("book/opening.fractal.html", "Opening"),
        page("book/part-one/second.fractal.html", "Second"),
        page("book/part-one/first.fractal.html", "First"),
        page("book/notes.html", "Raw notes", "raw")
      ]
    );

    expect(tree.map((node) => node.title)).toEqual(["Opening", "Part one"]);
    expect(pagePathsIn(tree)).toEqual([
      "opening.fractal.html",
      "part-one/second.fractal.html",
      "part-one/first.fractal.html"
    ]);
  });
});
