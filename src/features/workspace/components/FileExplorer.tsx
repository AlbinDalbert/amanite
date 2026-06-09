import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { FractalPage } from "@/lib/fractal/types";

type PageNode = {
  kind: "page";
  name: string;
  path: string;
};

type FolderNode = {
  kind: "folder";
  name: string;
  path: string;
  children: FileTreeNode[];
};

type FileTreeNode = FolderNode | PageNode;

type FileExplorerProps = {
  activePagePath: string;
  pages: FractalPage[];
  onSelectPage: (pagePath: string) => void;
};

type TreeRowStyle = CSSProperties & {
  "--tree-depth": number;
};

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function parentFolderPaths(path: string) {
  const parts = path.split("/").filter(Boolean);
  const folders = parts.slice(0, -1);

  return folders.map((_, index) => folders.slice(0, index + 1).join("/"));
}

function sortTreeNodes(left: FileTreeNode, right: FileTreeNode) {
  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1;
  }

  return left.name.localeCompare(right.name, undefined, {
    numeric: true,
    sensitivity: "base"
  });
}

function buildFileTree(pages: FractalPage[]) {
  const root: FolderNode = {
    kind: "folder",
    name: "",
    path: "",
    children: []
  };

  for (const page of pages) {
    const parts = page.path.split("/").filter(Boolean);
    let currentFolder = root;

    for (let index = 0; index < parts.length - 1; index += 1) {
      const folderName = parts[index];
      const folderPath = parts.slice(0, index + 1).join("/");
      const existingFolder = currentFolder.children.find(
        (node): node is FolderNode => node.kind === "folder" && node.path === folderPath
      );

      if (existingFolder) {
        currentFolder = existingFolder;
        continue;
      }

      const nextFolder: FolderNode = {
        kind: "folder",
        name: folderName,
        path: folderPath,
        children: []
      };

      currentFolder.children.push(nextFolder);
      currentFolder = nextFolder;
    }

    currentFolder.children.push({
      kind: "page",
      name: fileNameFromPath(page.path) || page.name,
      path: page.path
    });
  }

  function sortChildren(folder: FolderNode) {
    folder.children.sort(sortTreeNodes);

    for (const child of folder.children) {
      if (child.kind === "folder") {
        sortChildren(child);
      }
    }
  }

  sortChildren(root);

  return root.children;
}

function FileExplorer({ activePagePath, pages, onSelectPage }: FileExplorerProps) {
  const tree = useMemo(() => buildFileTree(pages), [pages]);
  const activeFolders = useMemo(() => parentFolderPaths(activePagePath), [activePagePath]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(activeFolders)
  );

  useEffect(() => {
    setExpandedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);
      let changed = false;

      for (const folderPath of activeFolders) {
        if (!nextPaths.has(folderPath)) {
          nextPaths.add(folderPath);
          changed = true;
        }
      }

      return changed ? nextPaths : currentPaths;
    });
  }, [activeFolders]);

  function toggleFolder(path: string) {
    setExpandedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths);

      if (nextPaths.has(path)) {
        nextPaths.delete(path);
      } else {
        nextPaths.add(path);
      }

      return nextPaths;
    });
  }

  function renderNode(node: FileTreeNode, depth: number) {
    const rowStyle: TreeRowStyle = {
      "--tree-depth": depth
    };

    if (node.kind === "folder") {
      const isExpanded = expandedPaths.has(node.path);

      return (
        <li
          aria-expanded={isExpanded}
          className="file-tree-node"
          key={node.path}
          role="treeitem"
        >
          <button
            className={isExpanded ? "explorer-row folder expanded" : "explorer-row folder"}
            onClick={() => toggleFolder(node.path)}
            style={rowStyle}
            title={node.path}
            type="button"
          >
            <span className="explorer-twist" aria-hidden="true" />
            <span className="explorer-icon folder" aria-hidden="true" />
            <span className="explorer-name">{node.name}</span>
          </button>

          {isExpanded ? (
            <ul className="file-tree-group" role="group">
              {node.children.map((child) => renderNode(child, depth + 1))}
            </ul>
          ) : null}
        </li>
      );
    }

    const isActive = node.path === activePagePath;

    return (
      <li
        aria-selected={isActive}
        className="file-tree-node"
        key={node.path}
        role="treeitem"
      >
        <button
          aria-current={isActive ? "page" : undefined}
          className={isActive ? "explorer-row page active" : "explorer-row page"}
          onClick={() => {
            if (!isActive) {
              onSelectPage(node.path);
            }
          }}
          style={rowStyle}
          title={node.path}
          type="button"
        >
          <span className="explorer-twist" aria-hidden="true" />
          <span className="explorer-icon page" aria-hidden="true" />
          <span className="explorer-name">{node.name}</span>
        </button>
      </li>
    );
  }

  return (
    <ul className="file-tree-group root" role="tree" aria-label="Project pages">
      {tree.map((node) => renderNode(node, 0))}
    </ul>
  );
}

export default FileExplorer;
