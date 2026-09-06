import { useEffect, useMemo, useState, type CSSProperties, type DragEvent, type MouseEvent, type ReactNode } from "react";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";

type Props = {
  activePagePath: string | null;
  activeFolderPath: string | null;
  isBusy: boolean;
  folders: FractalFolder[];
  pages: FractalPage[];
  onCreateFolder: (parent?: string) => void;
  onCreatePage: (parent?: string) => void;
  onDeletePage: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onDuplicatePage: (path: string) => void;
  onMovePage: (path: string) => void;
  onDropPage: (path: string, folder?: string) => void;
  onSelectPage: (path: string) => void;
  onSelectFolder: (path: string) => void;
  onRevealPage: (path?: string) => void;
  onValidate: () => void;
};

type Menu = { kind?: "folder" | "page"; path?: string; x: number; y: number };

export type ExplorerEntry =
  | { kind: "folder"; path: string; folder: FractalFolder; children: ExplorerEntry[] }
  | { kind: "page"; path: string; page: FractalPage };

export function compareExplorerEntries(a: ExplorerEntry, b: ExplorerEntry) {
  const rank = (entry: ExplorerEntry) => entry.kind === "folder" ? 0 : 1;
  return rank(a) - rank(b) || a.path.localeCompare(b.path, undefined, { sensitivity: "base", numeric: true });
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

function FileExplorer(props: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildExplorerTree(props.folders, props.pages), [props.folders, props.pages]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("resize", close); };
  }, [menu]);

  function openMenu(event: MouseEvent, path?: string, kind?: "folder" | "page") {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ kind, path, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 240) });
  }

  function run(action: () => void) { setMenu(null); action(); }
  function toggleFolder(path: string) {
    setCollapsedFolders((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  }

  function dropPage(event: DragEvent, folder?: string) {
    event.preventDefault();
    event.stopPropagation();
    const pagePath = event.dataTransfer.getData("application/x-amanite-page");
    setDropTarget(null);
    if (pagePath) props.onDropPage(pagePath, folder);
  }

  function renderEntries(entries: ExplorerEntry[]): ReactNode {
    return entries.map((entry) => entry.kind === "folder" ? (
      <li className="file-tree-node folder-node" key={`folder:${entry.path}`} role="treeitem" aria-expanded={!collapsedFolders.has(entry.path)} aria-selected={entry.path === props.activeFolderPath}>
        <div
          className={`${dropTarget === entry.path ? "explorer-row folder drop-target" : "explorer-row folder"}${entry.path === props.activeFolderPath ? " active" : ""}`}
          onContextMenu={(event) => openMenu(event, entry.path, "folder")}
          onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); setDropTarget(entry.path); }}
          onDragLeave={() => setDropTarget(null)}
          onDrop={(event) => dropPage(event, entry.path)}
          title={entry.path}
        >
          <button aria-label={`${collapsedFolders.has(entry.path) ? "Expand" : "Collapse"} ${entry.folder.title}`} className="explorer-folder-toggle" onClick={() => toggleFolder(entry.path)} type="button"><span className={collapsedFolders.has(entry.path) ? "explorer-twist" : "explorer-twist open"} /></button>
          <button className="explorer-folder-open" onClick={() => props.onSelectFolder(entry.path)} type="button"><span className="explorer-icon folder" /><span className="explorer-name">{entry.folder.title}</span></button>
        </div>
        {!collapsedFolders.has(entry.path) && entry.children.length ? <ul className="file-tree-group nested" role="group">{renderEntries(entry.children)}</ul> : null}
      </li>
    ) : (
      <li className="file-tree-node" key={entry.path} role="treeitem" aria-selected={entry.path === props.activePagePath}>
        <button
          className={entry.path === props.activePagePath ? "explorer-row page active" : "explorer-row page"}
          draggable={!props.isBusy}
          onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-amanite-page", entry.path); }}
          onDragEnd={() => setDropTarget(null)}
          onClick={() => props.onSelectPage(entry.path)}
          onContextMenu={(event) => openMenu(event, entry.path, "page")}
          title={entry.path}
          type="button"
        >
          <span className="explorer-twist" /><span className="explorer-icon page" /><span className="explorer-name">{entry.page.title || entry.path.split("/").at(-1)}</span><span className="explorer-kind">F</span>
        </button>
      </li>
    ));
  }

  return (
    <div
      className={dropTarget === "" ? "file-explorer-surface root-drop-target" : "file-explorer-surface"}
      onContextMenu={(event) => openMenu(event)}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}
      onDragOver={(event) => { event.preventDefault(); setDropTarget(""); }}
      onDrop={(event) => dropPage(event)}
    >
      <ul className="file-tree-group root" role="tree" aria-label="Project pages">
        {renderEntries(tree)}
      </ul>
      {menu ? (
        <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y } as CSSProperties}>
          <div className="file-context-label">{menu.path ?? "Project"}</div>
          {menu.kind === "page" && menu.path ? <>
            <button disabled={props.isBusy} onClick={() => run(() => props.onSelectPage(menu.path!))} role="menuitem">Open</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onMovePage(menu.path!))} role="menuitem">Move</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onDuplicatePage(menu.path!))} role="menuitem">Duplicate</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onRevealPage(menu.path!))} role="menuitem">Reveal in file manager</button>
            <button className="danger" disabled={props.isBusy} onClick={() => run(() => props.onDeletePage(menu.path!))} role="menuitem">Delete</button>
            <div className="file-context-separator" />
          </> : null}
          {menu.kind === "folder" && menu.path ? <>
            <button disabled={props.isBusy} onClick={() => run(() => props.onSelectFolder(menu.path!))} role="menuitem">Open folder</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onCreatePage(menu.path))} role="menuitem">New page here</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onCreateFolder(menu.path))} role="menuitem">New subfolder</button>
            <button className="danger" disabled={props.isBusy} onClick={() => run(() => props.onDeleteFolder(menu.path!))} role="menuitem">Delete folder</button>
            <div className="file-context-separator" />
          </> : null}
          {menu.kind !== "folder" ? <button disabled={props.isBusy} onClick={() => run(() => props.onCreatePage())} role="menuitem">Create page</button> : null}
          {menu.kind !== "folder" ? <button disabled={props.isBusy} onClick={() => run(() => props.onCreateFolder())} role="menuitem">Create folder</button> : null}
          <div className="file-context-separator" />
          <button disabled={props.isBusy} onClick={() => run(props.onValidate)} role="menuitem">Validate project</button>
          <button disabled={props.isBusy} onClick={() => run(() => props.onRevealPage())} role="menuitem">Reveal project folder</button>
        </div>
      ) : null}
    </div>
  );
}

export default FileExplorer;
