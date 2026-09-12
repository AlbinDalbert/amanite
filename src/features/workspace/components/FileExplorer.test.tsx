import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

function page(path: string) {
  return { path, contentHash: path, links: [], text: "" } as FractalPage;
}

function folder(path: string, title = path || "Project", children: FractalFolder["children"] = []): FractalFolder {
  return { children, issues: [], order: null, path, title };
}

describe("file explorer rendering", () => {
  it("renders pages and nested folders from the explorer tree", () => {
    const html = renderToStaticMarkup(
      <FileExplorer
        activeFolderPath="Characters"
        activePagePath="Characters/Vivian.fractal.html"
        folders={[folder("Characters", "Characters", [{ kind: "native", name: "Vivian.fractal.html", status: "present" }])]}
        isBusy={false}
        onCreateFolder={() => undefined}
        onCreatePage={() => undefined}
        onDeleteFolder={() => undefined}
        onDeletePage={() => undefined}
        onDropPage={() => undefined}
        onDuplicatePage={() => undefined}
        onMovePage={() => undefined}
        onRevealPage={() => undefined}
        onSelectFolder={() => undefined}
        onSelectPage={() => undefined}
        onValidate={() => undefined}
        pages={[page("Characters/Vivian.fractal.html")]}
      />
    );

    expect(html).toContain("Characters");
    expect(html).toContain("Vivian");
    expect(html).toContain("aria-label=\"Collapse Characters\"");
  });
});
