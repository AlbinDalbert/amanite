import type { FractalFolder, FractalPage } from "@/lib/fractal/types";

export type FolderExportNode = {
  kind: "folder" | "page";
  projectPath: string;
  relativePath: string;
  title: string;
  children: FolderExportNode[];
};

type Context = {
  folder: FractalFolder;
  folderByPath: Map<string, FractalFolder>;
  pageByPath: Map<string, FractalPage>;
};

function folderExportChildren(current: FractalFolder, context: Context): FolderExportNode[] {
  return current.children.flatMap<FolderExportNode>((child) => {
    if (child.status !== "present") return [];
    const projectPath = current.path ? `${current.path}/${child.name}` : child.name;
    const relativePath = context.folder.path ? projectPath.slice(context.folder.path.length + 1) : projectPath;
    if (child.kind === "folder") {
      const nested = context.folderByPath.get(projectPath);
      if (!nested) return [];
      return [{
        kind: "folder",
        projectPath,
        relativePath,
        title: nested.title,
        children: folderExportChildren(nested, context)
      }];
    }
    const page = context.pageByPath.get(projectPath);
    if (!page) return [];
    return [{
      kind: "page",
      projectPath,
      relativePath,
      title: page.title?.trim() || child.name.replace(/\.fractal\.html$/i, ""),
      children: []
    }];
  });
}

export function buildFolderExportTree(folder: FractalFolder, folders: FractalFolder[], pages: FractalPage[]): FolderExportNode[] {
  const folderByPath = new Map(folders.map((candidate) => [candidate.path, candidate]));
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  return folderExportChildren(folder, { folder, folderByPath, pageByPath });
}

export function pagePathsIn(nodes: FolderExportNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "page" ? [node.relativePath] : pagePathsIn(node.children));
}

export function folderPathsIn(nodes: FolderExportNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "folder" ? [node.relativePath, ...folderPathsIn(node.children)] : []);
}
