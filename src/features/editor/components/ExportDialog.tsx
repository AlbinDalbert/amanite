import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FractalHtmlExportReport, FractalPageKind } from "@/lib/fractal/types";

type Props = {
  kind: FractalPageKind;
  pagePath: string;
  onClose: () => void;
  onExport: (includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport | null>;
};

function ExportDialog({ kind, pagePath, onClose, onExport }: Props) {
  const [includeDerivedLinks, setIncludeDerivedLinks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const canExport = kind === "native";

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

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canExport || isExporting) return;
    setError(null);
    setIsExporting(true);
    try {
      const report = await onExport(includeDerivedLinks);
      if (report) onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <div className="modal-backdrop export-backdrop" onClick={(event) => event.target === event.currentTarget && !isExporting && onClose()}>
      <form aria-labelledby="export-title" aria-modal="true" className="export-dialog" onSubmit={submit} role="dialog">
        <header className="export-dialog-header">
          <div><p className="dialog-kicker">Publish a copy</p><h2 id="export-title">Export page</h2></div>
          <button aria-label="Close export" disabled={isExporting} onClick={onClose} type="button">×</button>
        </header>

        <div className="export-page-ticket">
          <span>Source</span>
          <strong>{pagePath.split("/").at(-1)?.replace(/\.fractal\.html$/i, "") || pagePath}</strong>
          <code>{pagePath}</code>
        </div>

        <fieldset className="export-format-picker">
          <legend>Format</legend>
          <label className="export-format selected">
            <input checked readOnly type="radio" />
            <span className="export-format-mark">HTML</span>
            <span><strong>Standalone HTML</strong><small>A portable page with Fractal markup removed.</small></span>
            <i>Available</i>
          </label>
          <p className="export-future-note">More export formats will appear here as Fractal adds them.</p>
        </fieldset>

        <fieldset className="export-options" disabled={!canExport || isExporting}>
          <legend>HTML options</legend>
          <label className="export-check-row">
            <input checked={includeDerivedLinks} onChange={(event) => setIncludeDerivedLinks(event.currentTarget.checked)} type="checkbox" />
            <span><strong>Include mentioned pages</strong><small>Add pages found through automatic title mentions to the references section.</small></span>
          </label>
          <p>Explicit page links are always included as references.</p>
        </fieldset>

        {!canExport ? <p className="export-error" role="alert">Standalone export is only available for native Fractal documents.</p> : null}
        {error ? <p className="export-error" role="alert">{error}</p> : null}

        <footer className="dialog-actions">
          <button className="ghost-action" disabled={isExporting} onClick={onClose} type="button">Cancel</button>
          <button className="primary-action" disabled={!canExport || isExporting} type="submit">{isExporting ? "Exporting..." : "Choose destination"}</button>
        </footer>
      </form>
    </div>
  );
}

export default ExportDialog;
