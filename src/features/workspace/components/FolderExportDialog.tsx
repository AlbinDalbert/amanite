import { useMemo, useState, type FormEvent } from "react";
import { useDialogFocus } from "@/components/ui/useDialogFocus";
import type {
  FractalFolder,
  FractalFolderHtmlExportOptions,
  FractalFolderHtmlExportReport,
  FractalPage
} from "@/lib/fractal/types";
import { buildFolderExportTree, folderPathsIn, pagePathsIn } from "./folderExportTreeBuilder";
import FolderExportFooter from "./FolderExportFooter";
import FolderExportSelection from "./FolderExportSelection";
import FolderExportSettings from "./FolderExportSettings";

type Props = {
  folder: FractalFolder;
  folders: FractalFolder[];
  pages: FractalPage[];
  onClose: () => void;
  onExport: (options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport | null>;
};

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
  const dialogRef = useDialogFocus(isExporting, onClose);
  const selectedCount = allPagePaths.filter((path) => selected.has(path)).length;
  const canExport = allPagePaths.length === 0 || selectedCount > 0;

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
          <FolderExportSelection allPagePaths={allPagePaths} expanded={expanded} folder={folder} onExpand={(path) => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next; })} onToggle={toggle} selected={selected} selectedCount={selectedCount} tree={tree} />

          <FolderExportSettings disabled={isExporting} force={force} includeDerivedLinks={includeDerivedLinks} numberSections={numberSections} onForceChange={setForce} onIncludeDerivedLinksChange={setIncludeDerivedLinks} onNumberSectionsChange={setNumberSections} />
        </div>

        <FolderExportFooter canExport={canExport} error={error} isExporting={isExporting} onClose={onClose} report={report} selectedCount={selectedCount} />
      </form>
    </div>
  );
}

export default FolderExportDialog;
