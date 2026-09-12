import type { FractalFolderHtmlExportReport } from "@/lib/fractal/types";

type Props = {
  canExport: boolean;
  error: string | null;
  isExporting: boolean;
  onClose: () => void;
  report: FractalFolderHtmlExportReport | null;
  selectedCount: number;
};

function ExportReport({ report }: Pick<Props, "report">) {
  if (!report) return null;
  const referenceNote = report.references.length ? `, ${report.references.length} references added` : "";
  const skippedNote = report.skipped.length
    ? `${report.skipped.length} invalid ${report.skipped.length === 1 ? "page was" : "pages were"} skipped.`
    : null;
  return (
    <div className="folder-export-report" role="status">
      <strong>Export complete</strong>
      <span>{report.pages.length} pages written{referenceNote}.</span>
      {skippedNote ? <small>{skippedNote}</small> : null}
      <code>{report.output}</code>
    </div>
  );
}

export default function FolderExportFooter({ canExport, error, isExporting, onClose, report, selectedCount }: Props) {
  const exportLabel = isExporting ? "Exporting…" : report ? "Export again" : `Export ${selectedCount || "empty folder"}`;
  return (
    <>
      {!canExport ? <p className="export-error" role="alert">Select at least one page, or close the dialog.</p> : null}
      {error ? <p className="export-error" role="alert">{error}</p> : null}
      <ExportReport report={report} />
      <footer className="dialog-actions">
        <button className="ghost-action" disabled={isExporting} onClick={onClose} type="button">{report ? "Done" : "Cancel"}</button>
        <button className="primary-action" disabled={!canExport || isExporting} type="submit">{exportLabel}</button>
      </footer>
    </>
  );
}
