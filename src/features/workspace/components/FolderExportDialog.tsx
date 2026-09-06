import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type {
  FractalFolder,
  FractalFolderHtmlExportOptions,
  FractalFolderHtmlExportReport,
  FractalPage
} from "@/lib/fractal/types";

export type FolderExportNode = {
  kind: "folder" | "page";
  projectPath: string;
  relativePath: string;
  title: string;
  children: FolderExportNode[];
};

type Props = {
  folder: FractalFolder;
  folders: FractalFolder[];
  pages: FractalPage[];
  onClose: () => void;
  onExport: (options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport | null>;
};

function joinPath(parent: string, name: string) {
  return parent ? `${parent}/${name}` : name;
}

function relativeToFolder(folderPath: string, path: string) {
  return folderPath ? path.slice(folderPath.length + 1) : path;
}

export function buildFolderExportTree(folder: FractalFolder, folders: FractalFolder[], pages: FractalPage[]): FolderExportNode[] {
  const folderByPath = new Map(folders.map((candidate) => [candidate.path, candidate]));
  const pageByPath = new Map(pages.map((page) => [page.path, page]));

  function childrenOf(current: FractalFolder): FolderExportNode[] {
    return current.children.flatMap<FolderExportNode>((child) => {
      if (child.status !== "present") return [];
      const projectPath = joinPath(current.path, child.name);
      const relativePath = relativeToFolder(folder.path, projectPath);
      if (child.kind === "folder") {
        const nested = folderByPath.get(projectPath);
        if (!nested) return [];
        return [{ kind: "folder" as const, projectPath, relativePath, title: nested.title, children: childrenOf(nested) }];
      }
      const page = pageByPath.get(projectPath);
      if (!page) return [];
      return [{ kind: "page" as const, projectPath, relativePath, title: page.title?.trim() || child.name.replace(/\.fractal\.html$/i, ""), children: [] }];
    });
  }

  return childrenOf(folder);
}

export function pagePathsIn(nodes: FolderExportNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "page" ? [node.relativePath] : pagePathsIn(node.children));
}

function folderPathsIn(nodes: FolderExportNode[]): string[] {
  return nodes.flatMap((node) => node.kind === "folder" ? [node.relativePath, ...folderPathsIn(node.children)] : []);
}

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

function FolderExportDialog({ folder, folders, pages, onClose, onExport }: Props) {
  const tree = useMemo(() => buildFolderExportTree(folder, folders, pages), [folder, folders, pages]);
  const allPagePaths = useMemo(() => pagePathsIn(tree), [tree]);
  const [selected, setSelected] = useState(() => new Set(allPagePaths));
  const [expanded, setExpanded] = useState(() => new Set(folderPathsIn(tree)));
  const [numberSections, setNumberSections] = useState(false);
  const [includeDerivedLinks, setIncludeDerivedLinks] = useState(false);
  const [force, setForce] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FractalFolderHtmlExportReport | null>(null);
  const dialogRef = useRef<HTMLFormElement>(null);
  const selectedCount = allPagePaths.filter((path) => selected.has(path)).length;
  const canExport = allPagePaths.length === 0 || selectedCount > 0;

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isExporting) onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previousFocus?.focus();
    };
  }, [isExporting, onClose]);

  function toggle(paths: string[], checked: boolean) {
    setReport(null);
    setSelected((current) => {
      const next = new Set(current);
      for (const path of paths) checked ? next.add(path) : next.delete(path);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canExport || isExporting) return;
    setError(null);
    setReport(null);
    setIsExporting(true);
    try {
      const selections = selectedCount === allPagePaths.length ? [] : allPagePaths.filter((path) => selected.has(path));
      const result = await onExport({ selections, numberSections, includeDerivedLinks, force });
      if (result) setReport(result);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="modal-backdrop folder-export-backdrop" onClick={(event) => event.target === event.currentTarget && !isExporting && onClose()}>
      <form aria-labelledby="folder-export-title" aria-modal="true" className="folder-export-dialog" onSubmit={submit} ref={dialogRef} role="dialog" tabIndex={-1}>
        <header className="export-dialog-header">
          <div><p className="dialog-kicker">Assemble a document</p><h2 id="folder-export-title">Export folder</h2></div>
          <button aria-label="Close folder export" disabled={isExporting} onClick={onClose} type="button">×</button>
        </header>

        <div className="export-page-ticket folder-export-ticket">
          <span>Source</span><strong>{folder.title}</strong><code>{folder.path || "Pages"}</code>
        </div>

        <div className="folder-export-layout">
          <section className="folder-export-selection" aria-labelledby="folder-export-selection-title">
            <header>
              <div><span id="folder-export-selection-title">Contents</span><small>{selectedCount} of {allPagePaths.length} selected</small></div>
              <div><button onClick={() => toggle(allPagePaths, true)} type="button">All</button><button onClick={() => toggle(allPagePaths, false)} type="button">None</button></div>
            </header>
            <div className="folder-export-root-row">
              <SelectionCheckbox checked={allPagePaths.length > 0 && selectedCount === allPagePaths.length} indeterminate={selectedCount > 0 && selectedCount < allPagePaths.length} label={`Include all pages in ${folder.title}`} onChange={() => toggle(allPagePaths, selectedCount !== allPagePaths.length)} />
              <span>Folder</span><strong>{folder.title}</strong>
            </div>
            {tree.length ? <ul className="folder-export-tree">{tree.map((node) => <ExportTreeRow depth={0} expanded={expanded} key={`${node.kind}:${node.relativePath}`} node={node} selected={selected} onExpand={(path) => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })} onToggle={toggle} />)}</ul> : <p className="folder-export-empty">This folder has no native pages. Fractal will create an empty HTML document.</p>}
          </section>

          <aside className="folder-export-settings">
            <div className="folder-export-format"><span>HTML</span><div><strong>One document</strong><small>Pages stay in Fractal order.</small></div></div>
            <fieldset className="export-options" disabled={isExporting}>
              <legend>Document</legend>
              <label className="export-check-row"><input checked={numberSections} onChange={(event) => setNumberSections(event.currentTarget.checked)} type="checkbox" /><span><strong>Number sections</strong><small>Prefix page headings with 1, 2, 3…</small></span></label>
              <label className="export-check-row"><input checked={includeDerivedLinks} onChange={(event) => setIncludeDerivedLinks(event.currentTarget.checked)} type="checkbox" /><span><strong>Include title mentions</strong><small>Turn unlinked page-title mentions into links or references.</small></span></label>
            </fieldset>
            <fieldset className="folder-export-validity" disabled={isExporting}>
              <legend>Invalid pages</legend>
              <label className={!force ? "selected" : ""}><input checked={!force} name="invalid-pages" onChange={() => setForce(false)} type="radio" /><span><strong>Stop export</strong><small>Fix the page before exporting.</small></span></label>
              <label className={force ? "selected" : ""}><input checked={force} name="invalid-pages" onChange={() => setForce(true)} type="radio" /><span><strong>Skip and report</strong><small>Export every valid selected page.</small></span></label>
            </fieldset>
          </aside>
        </div>

        {!canExport ? <p className="export-error" role="alert">Select at least one page, or close the dialog.</p> : null}
        {error ? <p className="export-error" role="alert">{error}</p> : null}
        {report ? <div className="folder-export-report" role="status"><strong>Export complete</strong><span>{report.pages.length} pages written{report.references.length ? `, ${report.references.length} references added` : ""}.</span>{report.skipped.length ? <small>{report.skipped.length} invalid {report.skipped.length === 1 ? "page was" : "pages were"} skipped.</small> : null}<code>{report.output}</code></div> : null}

        <footer className="dialog-actions">
          <button className="ghost-action" disabled={isExporting} onClick={onClose} type="button">{report ? "Done" : "Cancel"}</button>
          <button className="primary-action" disabled={!canExport || isExporting} type="submit">{isExporting ? "Exporting…" : report ? "Export again" : `Export ${selectedCount || "empty folder"}`}</button>
        </footer>
      </form>
    </div>
  );
}

export default FolderExportDialog;
