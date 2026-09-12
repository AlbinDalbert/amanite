import { useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import { buildExplorerTree } from "./fileExplorerTree";
import FileExplorerContextMenu from "./FileExplorerContextMenu";
import FileExplorerTree from "./FileExplorerTree";
import type { ExplorerEntry, FileExplorerMenu } from "./fileExplorerTypes";

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

function FileExplorer(props: Props) {
  const [menu, setMenu] = useState<FileExplorerMenu | null>(null);
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

  return (
    <div
      className={dropTarget === "" ? "file-explorer-surface root-drop-target" : "file-explorer-surface"}
      onContextMenu={(event) => openMenu(event)}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDropTarget(null); }}
      onDragOver={(event) => { event.preventDefault(); setDropTarget(""); }}
      onDrop={(event) => dropPage(event)}
    >
      <FileExplorerTree activeFolderPath={props.activeFolderPath} activePagePath={props.activePagePath} collapsedFolders={collapsedFolders} dropTarget={dropTarget} entries={tree} isBusy={props.isBusy} onContextMenu={openMenu} onDropPage={dropPage} onSelectFolder={props.onSelectFolder} onSelectPage={props.onSelectPage} onSetDropTarget={setDropTarget} onToggleFolder={toggleFolder} />
      {menu ? (
        <FileExplorerContextMenu isBusy={props.isBusy} menu={menu} onCreateFolder={props.onCreateFolder} onCreatePage={props.onCreatePage} onDeleteFolder={props.onDeleteFolder} onDeletePage={props.onDeletePage} onDuplicatePage={props.onDuplicatePage} onMovePage={props.onMovePage} onRevealPage={props.onRevealPage} onRun={run} onSelectFolder={props.onSelectFolder} onSelectPage={props.onSelectPage} onValidate={props.onValidate} />
      ) : null}
    </div>
  );
}

export default FileExplorer;
