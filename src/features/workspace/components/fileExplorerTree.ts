import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import type { ExplorerEntry } from "./fileExplorerTypes";

export function compareExplorerEntries(a: ExplorerEntry, b: ExplorerEntry) {
  if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
  return a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true });
}

export function buildExplorerTree(folders: FractalFolder[], pages: FractalPage[]) {
  const roots: ExplorerEntry[] = [];
  const folderNodes = new Map<string, Extract<ExplorerEntry, { kind: "folder" }>>();
  for (const folder of folders.filter((candidate) => candidate.path).sort((a, b) => a.path.split("/").length - b.path.split("/").length || a.path.localeCompare(b.path))) {
    const path = folder.path;
    const node: Extract<ExplorerEntry, { kind: "folder" }> = { kind: "folder", path, folder, children: [] };
    folderNodes.set(path, node);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
    const parent = parentPath ? folderNodes.get(parentPath) : null;
    (parent?.children ?? roots).push(node);
  }
  for (const page of pages) {
    const parentPath = page.path.includes("/") ? page.path.slice(0, page.path.lastIndexOf("/")) : null;
    const parent = parentPath ? folderNodes.get(parentPath) : null;
    (parent?.children ?? roots).push({ kind: "page", path: page.path, page });
  }
  const sort = (entries: ExplorerEntry[], parentPath: string) => {
    const order = new Map(folders.find((folder) => folder.path === parentPath)?.children.map((child, index) => [child.name, index]) ?? []);
    entries.sort((a, b) => {
      const aName = a.path.split("/").at(-1)!;
      const bName = b.path.split("/").at(-1)!;
      const aIndex = order.get(aName);
      const bIndex = order.get(bName);
      if (aIndex != null || bIndex != null) return (aIndex ?? Number.MAX_SAFE_INTEGER) - (bIndex ?? Number.MAX_SAFE_INTEGER);
      return compareExplorerEntries(a, b);
    });
    for (const entry of entries) if (entry.kind === "folder") sort(entry.children, entry.path);
  };
  sort(roots, "");
  return roots;
}
