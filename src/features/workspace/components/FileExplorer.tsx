import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent
} from "react";
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
  canDeletePage: boolean;
  isBusy: boolean;
  pages: FractalPage[];
  onBuildIndex: () => void;
  onCreatePage: (pagePath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSelectPage: (pagePath: string) => void;
  onValidate: () => void;
};

type TreeRowStyle = CSSProperties & {
  "--tree-depth": number;
};

type ContextMenuTarget =
  | {
      kind: "page";
      pagePath: string;
    }
  | {
      kind: "folder";
      folderPath: string;
    }
  | {
      kind: "project";
    };

type ContextMenuState = ContextMenuTarget & {
  x: number;
  y: number;
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

function menuPosition(event: MouseEvent) {
  const menuWidth = 224;
  const menuHeight = 252;

  return {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
  };
}

function FileExplorer({
  activePagePath,
  canDeletePage,
  isBusy,
  pages,
  onBuildIndex,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSelectPage,
  onValidate
}: FileExplorerProps) {
  const tree = useMemo(() => buildFileTree(pages), [pages]);
  const activeFolders = useMemo(() => parentFolderPaths(activePagePath), [activePagePath]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(activeFolders)
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

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

  useEffect(() => {
    if (!contextMenu) {
      return;
    }

    function closeContextMenu() {
      setContextMenu(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeContextMenu();
      }
    }

    window.addEventListener("click", closeContextMenu);
    window.addEventListener("contextmenu", closeContextMenu, true);
    window.addEventListener("resize", closeContextMenu);
    window.addEventListener("scroll", closeContextMenu, true);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeContextMenu);
      window.removeEventListener("contextmenu", closeContextMenu, true);
      window.removeEventListener("resize", closeContextMenu);
      window.removeEventListener("scroll", closeContextMenu, true);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [contextMenu]);

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

  function openContextMenu(event: MouseEvent, target: ContextMenuTarget) {
    event.preventDefault();
    event.stopPropagation();

    setContextMenu({
      ...target,
      ...menuPosition(event)
    });
  }

  function handleProjectContextMenu(event: MouseEvent<HTMLUListElement>) {
    if (event.currentTarget !== event.target) {
      return;
    }

    openContextMenu(event, { kind: "project" });
  }

  function createPageFromMenu(folderPath?: string) {
    onCreatePage(folderPath ? `${folderPath}/untitled` : "untitled");
  }

  function renamePageFromMenu(pagePath: string) {
    const nextPagePath = window.prompt("Rename or move page", pagePath);

    if (nextPagePath) {
      onRenamePage(pagePath, nextPagePath);
    }
  }

  function runContextAction(action: () => void) {
    setContextMenu(null);
    action();
  }

  function renderContextMenu() {
    if (!contextMenu) {
      return null;
    }

    const menuStyle: CSSProperties = {
      left: contextMenu.x,
      top: contextMenu.y
    };
    const targetPath =
      contextMenu.kind === "page"
        ? contextMenu.pagePath
        : contextMenu.kind === "folder"
          ? contextMenu.folderPath
          : "Project";
    const pagePath = contextMenu.kind === "page" ? contextMenu.pagePath : null;
    const folderPath = contextMenu.kind === "folder" ? contextMenu.folderPath : undefined;

    return (
      <div
        aria-label="File actions"
        className="file-context-menu"
        role="menu"
        style={menuStyle}
      >
        <div className="file-context-label" title={targetPath}>
          {targetPath}
        </div>

        {pagePath ? (
          <>
            <button
              disabled={isBusy || pagePath === activePagePath}
              onClick={() => runContextAction(() => onSelectPage(pagePath))}
              role="menuitem"
              type="button"
            >
              Open
            </button>
            <button
              disabled={isBusy}
              onClick={() => runContextAction(() => renamePageFromMenu(pagePath))}
              role="menuitem"
              type="button"
            >
              Rename
            </button>
            <button
              className="danger"
              disabled={isBusy || !canDeletePage}
              onClick={() => runContextAction(() => onDeletePage(pagePath))}
              role="menuitem"
              title={
                canDeletePage
                  ? `Delete ${pagePath}`
                  : "A Fractal project must keep at least one page."
              }
              type="button"
            >
              Delete
            </button>
          </>
        ) : (
          <button
            disabled={isBusy}
            onClick={() => runContextAction(() => createPageFromMenu(folderPath))}
            role="menuitem"
            type="button"
          >
            New page
          </button>
        )}

        <div className="file-context-separator" role="separator" />
        <button
          disabled={isBusy}
          onClick={() => runContextAction(onValidate)}
          role="menuitem"
          type="button"
        >
          Validate project
        </button>
        <button
          disabled={isBusy}
          onClick={() => runContextAction(onBuildIndex)}
          role="menuitem"
          type="button"
        >
          Build index
        </button>
      </div>
    );
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
            onContextMenu={(event) =>
              openContextMenu(event, {
                kind: "folder",
                folderPath: node.path
              })
            }
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
          onContextMenu={(event) =>
            openContextMenu(event, {
              kind: "page",
              pagePath: node.path
            })
          }
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
    <>
      <ul
        className="file-tree-group root"
        role="tree"
        aria-label="Project pages"
        onContextMenu={handleProjectContextMenu}
      >
        {tree.map((node) => renderNode(node, 0))}
      </ul>
      {renderContextMenu()}
    </>
  );
}

export default FileExplorer;
