import { useEffect, useRef } from "react";
import type { FractalFolder } from "@/lib/fractal/types";
import { pagePathsIn, type FolderExportNode } from "./folderExportTreeBuilder";

type Props = {
  allPagePaths: string[];
  expanded: Set<string>;
  folder: FractalFolder;
  onExpand: (path: string) => void;
  onToggle: (paths: string[], checked: boolean) => void;
  selected: Set<string>;
  selectedCount: number;
  tree: FolderExportNode[];
};

function SelectionCheckbox({ checked, indeterminate, label, onChange }: {
  checked: boolean;
  indeterminate: boolean;
  label: string;
  onChange: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return <input aria-label={label} checked={checked} onChange={onChange} ref={ref} type="checkbox" />;
}

function ExportTreeRow({ depth, expanded, node, selected, onExpand, onToggle }: {
  depth: number;
  expanded: Set<string>;
  node: FolderExportNode;
  selected: Set<string>;
  onExpand: (path: string) => void;
  onToggle: (paths: string[], checked: boolean) => void;
}) {
  const paths = node.kind === "page" ? [node.relativePath] : pagePathsIn(node.children);
  const selectedCount = paths.filter((path) => selected.has(path)).length;
  const checked = paths.length > 0 && selectedCount === paths.length;
  const indeterminate = selectedCount > 0 && selectedCount < paths.length;
  const open = node.kind === "folder" && expanded.has(node.relativePath);

  return (
    <li>
      <div className={`folder-export-tree-row ${node.kind}`} style={{ "--tree-depth": depth } as React.CSSProperties}>
        {node.kind === "folder" ? (
          <button aria-label={`${open ? "Collapse" : "Expand"} ${node.title}`} aria-expanded={open} className="folder-export-disclosure" onClick={() => onExpand(node.relativePath)} type="button">›</button>
        ) : <span className="folder-export-leaf" />}
        <SelectionCheckbox checked={checked} indeterminate={indeterminate} label={`Include ${node.title}`} onChange={() => onToggle(paths, !checked)} />
        <span className="folder-export-node-mark" aria-hidden="true">{node.kind === "folder" ? "F" : String(depth + 1).padStart(2, "0")}</span>
        <button className="folder-export-node-label" onClick={() => onToggle(paths, !checked)} type="button">
          <strong>{node.title}</strong>
          <small>{node.kind === "folder" ? `${paths.length} ${paths.length === 1 ? "page" : "pages"}` : node.relativePath}</small>
        </button>
      </div>
      {node.kind === "folder" && open ? <ul>{node.children.map((child) => <ExportTreeRow depth={depth + 1} expanded={expanded} key={`${child.kind}:${child.relativePath}`} node={child} selected={selected} onExpand={onExpand} onToggle={onToggle} />)}</ul> : null}
    </li>
  );
}

export default function FolderExportSelection({ allPagePaths, expanded, folder, onExpand, onToggle, selected, selectedCount, tree }: Props) {
  return (
    <section className="folder-export-selection" aria-labelledby="folder-export-selection-title">
      <header>
        <div><span id="folder-export-selection-title">Contents</span><small>{selectedCount} of {allPagePaths.length} selected</small></div>
        <div><button onClick={() => onToggle(allPagePaths, true)} type="button">All</button><button onClick={() => onToggle(allPagePaths, false)} type="button">None</button></div>
      </header>
      <div className="folder-export-root-row">
        <SelectionCheckbox checked={allPagePaths.length > 0 && selectedCount === allPagePaths.length} indeterminate={selectedCount > 0 && selectedCount < allPagePaths.length} label={`Include all pages in ${folder.title}`} onChange={() => onToggle(allPagePaths, selectedCount !== allPagePaths.length)} />
        <span>Folder</span><strong>{folder.title}</strong>
      </div>
      {tree.length ? <ul className="folder-export-tree">{tree.map((node) => <ExportTreeRow depth={0} expanded={expanded} key={`${node.kind}:${node.relativePath}`} node={node} selected={selected} onExpand={onExpand} onToggle={onToggle} />)}</ul> : <p className="folder-export-empty">This folder has no native pages. Fractal will create an empty HTML document.</p>}
    </section>
  );
}
