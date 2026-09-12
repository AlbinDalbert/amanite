import type { DragEvent, MouseEvent } from "react";
import type { ExplorerEntry } from "./fileExplorerTypes";

type Props = {
  activeFolderPath: string | null;
  activePagePath: string | null;
  collapsedFolders: Set<string>;
  entries: ExplorerEntry[];
  isBusy: boolean;
  onContextMenu: (event: MouseEvent, path?: string, kind?: "folder" | "page") => void;
  onDropPage: (event: DragEvent, folder?: string) => void;
  onSelectFolder: (path: string) => void;
  onSelectPage: (path: string) => void;
  onSetDropTarget: (path: string | null) => void;
  onToggleFolder: (path: string) => void;
  dropTarget: string | null;
};

function ExplorerFolderRow({ activeFolderPath, collapsedFolders, entry, onContextMenu, onDropPage, onSelectFolder, onSetDropTarget, onToggleFolder, renderEntries, dropTarget }: Omit<Props, "isBusy"> & { entry: Extract<ExplorerEntry, { kind: "folder" }>; renderEntries: (entries: ExplorerEntry[]) => React.ReactNode }) {
  const collapsed = collapsedFolders.has(entry.path);
  const active = entry.path === activeFolderPath;
  return (
    <li className="file-tree-node folder-node" role="treeitem" aria-expanded={!collapsed} aria-selected={active}>
      <div
        className={`${dropTarget === entry.path ? "explorer-row folder drop-target" : "explorer-row folder"}${active ? " active" : ""}`}
        onContextMenu={(event) => onContextMenu(event, entry.path, "folder")}
        onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); onSetDropTarget(entry.path); }}
        onDragLeave={() => onSetDropTarget(null)}
        onDrop={(event) => onDropPage(event, entry.path)}
        title={entry.path}
      >
        <button aria-label={`${collapsed ? "Expand" : "Collapse"} ${entry.folder.title}`} className="explorer-folder-toggle" onClick={() => onToggleFolder(entry.path)} type="button"><span className={collapsed ? "explorer-twist" : "explorer-twist open"} /></button>
        <button className="explorer-folder-open" onClick={() => onSelectFolder(entry.path)} type="button"><span className="explorer-icon folder" /><span className="explorer-name">{entry.folder.title}</span></button>
      </div>
      {!collapsed && entry.children.length ? <ul className="file-tree-group nested" role="group">{renderEntries(entry.children)}</ul> : null}
    </li>
  );
}

function ExplorerPageRow({ activePagePath, entry, isBusy, onContextMenu, onSelectPage, onSetDropTarget }: Props & { entry: Extract<ExplorerEntry, { kind: "page" }> }) {
  const active = entry.path === activePagePath;
  return (
    <li className="file-tree-node" role="treeitem" aria-selected={active}>
      <button
        className={active ? "explorer-row page active" : "explorer-row page"}
        draggable={!isBusy}
        onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-amanite-page", entry.path); }}
        onDragEnd={() => onSetDropTarget(null)}
        onClick={() => onSelectPage(entry.path)}
        onContextMenu={(event) => onContextMenu(event, entry.path, "page")}
        title={entry.path}
        type="button"
      >
        <span className="explorer-twist" /><span className="explorer-icon page" /><span className="explorer-name">{entry.page.title || entry.path.split("/").at(-1)}</span><span className="explorer-kind">F</span>
      </button>
    </li>
  );
}

export default function FileExplorerTree(props: Props) {
  const renderEntries = (entries: ExplorerEntry[]): React.ReactNode => entries.map((entry) => entry.kind === "folder"
    ? <ExplorerFolderRow key={`folder:${entry.path}`} {...props} entry={entry} renderEntries={renderEntries} />
    : <ExplorerPageRow key={`page:${entry.path}`} {...props} entry={entry} />);

  return <ul className="file-tree-group root" role="tree" aria-label="Project pages">{renderEntries(props.entries)}</ul>;
}
