import { useEffect, useState, type CSSProperties, type MouseEvent } from "react";
import type { FractalPage } from "@/lib/fractal/types";

type Props = {
  activePagePath: string | null;
  isBusy: boolean;
  pages: FractalPage[];
  onCreatePage: () => void;
  onDeletePage: (path: string) => void;
  onMovePage: (path: string) => void;
  onSelectPage: (path: string) => void;
  onValidate: () => void;
};

type Menu = { path?: string; x: number; y: number };

function FileExplorer(props: Props) {
  const [menu, setMenu] = useState<Menu | null>(null);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("click", close); window.removeEventListener("resize", close); };
  }, [menu]);

  function openMenu(event: MouseEvent, path?: string) {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ path, x: Math.min(event.clientX, window.innerWidth - 230), y: Math.min(event.clientY, window.innerHeight - 220) });
  }

  function run(action: () => void) { setMenu(null); action(); }

  return (
    <div className="file-explorer-surface" onContextMenu={(event) => openMenu(event)}>
      <ul className="file-tree-group root" role="tree" aria-label="Project pages">
        {props.pages.map((page) => (
          <li className="file-tree-node" key={page.path} role="treeitem" aria-selected={page.path === props.activePagePath}>
            <button
              className={page.path === props.activePagePath ? "explorer-row page active" : "explorer-row page"}
              onClick={() => props.onSelectPage(page.path)}
              onContextMenu={(event) => openMenu(event, page.path)}
              title={page.path}
              type="button"
            >
              <span className="explorer-twist" /><span className={`explorer-icon page ${page.kind}`} /><span className="explorer-name">{page.title || page.path}</span><span className={`explorer-kind ${page.kind}`}>{page.kind === "native" ? "F" : "HTML"}</span>
            </button>
          </li>
        ))}
      </ul>
      {menu ? (
        <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y } as CSSProperties}>
          <div className="file-context-label">{menu.path ?? "Project"}</div>
          {menu.path ? <>
            <button disabled={props.isBusy} onClick={() => run(() => props.onSelectPage(menu.path!))} role="menuitem">Open</button>
            <button disabled={props.isBusy} onClick={() => run(() => props.onMovePage(menu.path!))} role="menuitem">Move</button>
            <button className="danger" disabled={props.isBusy} onClick={() => run(() => props.onDeletePage(menu.path!))} role="menuitem">Delete</button>
            <div className="file-context-separator" />
          </> : null}
          <button disabled={props.isBusy} onClick={() => run(props.onCreatePage)} role="menuitem">Create page</button>
          <div className="file-context-separator" />
          <button disabled={props.isBusy} onClick={() => run(props.onValidate)} role="menuitem">Validate project</button>
        </div>
      ) : null}
    </div>
  );
}

export default FileExplorer;
