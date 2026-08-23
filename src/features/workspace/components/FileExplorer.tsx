import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import type { FractalPage } from "@/lib/fractal/types";

type Props = {
  activePagePath: string | null;
  isBusy: boolean;
  folders: string[];
  pages: FractalPage[];
  onCreateFolder: () => void;
  onCreatePage: () => void;
  onDeletePage: (path: string) => void;
  onDeleteFolder: (path: string) => void;
  onMovePage: (path: string) => void;
  onSelectPage: (path: string) => void;
  onValidate: () => void;
};

type Menu = { kind?: "folder" | "page"; path?: string; x: number; y: number };

function FileExplorer(props: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
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

  return (
    <div className="file-explorer-surface" onContextMenu={(event) => openMenu(event)}>
      <ul className="file-tree-group root" role="tree" aria-label="Project pages">
        {[...props.folders.map((path) => ({ kind: "folder" as const, path })), ...props.pages.map((page) => ({ kind: "page" as const, path: page.path, page }))]
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((entry) => entry.kind === "folder" ? (
          <li className="file-tree-node" key={`folder:${entry.path}`} role="treeitem" style={{ "--tree-depth": entry.path.split("/").length - 1 } as CSSProperties}>
            <button className="explorer-row folder" onContextMenu={(event) => openMenu(event, entry.path, "folder")} title={entry.path} type="button">
              <span className="explorer-twist open">⌄</span><span className="explorer-icon folder" /><span className="explorer-name">{entry.path.split("/").at(-1)}</span>
            </button>
          </li>
        ) : (
          <li className="file-tree-node" key={entry.path} role="treeitem" aria-selected={entry.path === props.activePagePath} style={{ "--tree-depth": entry.path.split("/").length - 1 } as CSSProperties}>
            <button
              className={entry.path === props.activePagePath ? "explorer-row page active" : "explorer-row page"}
              onClick={() => props.onSelectPage(entry.path)}
              onContextMenu={(event) => openMenu(event, entry.path, "page")}
              title={entry.path}
              type="button"
            >
              <span className="explorer-twist" /><span className={`explorer-icon page ${entry.page.kind}`} /><span className="explorer-name">{entry.page.title || entry.path.split("/").at(-1)}</span><span className={`explorer-kind ${entry.page.kind}`}>{entry.page.kind === "native" ? "F" : "HTML"}</span>
            </button>
          </li>
        ))}
      </ul>
      {menu ? (
        <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y } as CSSProperties}>
          <div className="file-context-label">{menu.path ?? "Project"}</div>
          {menu.kind === "page" && menu.path ? <>
            <button disabled={props.isBusy} onClick={() => run(() => props.onSelectPage(menu.path!))} role="menuitem">Open</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onMovePage(menu.path!))} role="menuitem">Move</button>
            <button className="danger" disabled={props.isBusy} onClick={() => run(() => props.onDeletePage(menu.path!))} role="menuitem">Delete</button>
            <div className="file-context-separator" />
          </> : null}
          {menu.kind === "folder" && menu.path ? <>
            <button className="danger" disabled={props.isBusy} onClick={() => run(() => props.onDeleteFolder(menu.path!))} role="menuitem">Delete folder</button>
            <div className="file-context-separator" />
          </> : null}
          <button disabled={props.isBusy} onClick={() => run(props.onCreatePage)} role="menuitem">Create page</button>
          <button disabled={props.isBusy} onClick={() => run(props.onCreateFolder)} role="menuitem">Create folder</button>
          <div className="file-context-separator" />
          <button disabled={props.isBusy} onClick={() => run(props.onValidate)} role="menuitem">Validate project</button>
        </div>
      ) : null}
    </div>
  );
}

export default FileExplorer;
