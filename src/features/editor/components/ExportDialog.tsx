import { useState, type FormEvent } from "react";
import DerivedLinksOption from "@/components/ui/DerivedLinksOption";
import { useDialogFocus } from "@/components/ui/useDialogFocus";
import type { FractalHtmlExportReport } from "@/lib/fractal/types";

type Props = {
  pagePath: string;
  onClose: () => void;
  onExport: (includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport | null>;
};

function ExportDialog({ pagePath, onClose, onExport }: Props) {
  const [includeDerivedLinks, setIncludeDerivedLinks] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useDialogFocus(isExporting, onClose);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (isExporting) return;
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
      <form aria-labelledby="export-title" aria-modal="true" className="export-dialog" onSubmit={submit} ref={dialogRef} role="dialog" tabIndex={-1}>
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

        <fieldset className="export-options" disabled={isExporting}>
          <legend>HTML options</legend>
          <DerivedLinksOption
            checked={includeDerivedLinks}
            description="Add pages found through automatic title mentions to the references section."
            label="Include mentioned pages"
            onChange={setIncludeDerivedLinks}
          />
          <p>Explicit page links are always included as references.</p>
        </fieldset>

        {error ? <p className="export-error" role="alert">{error}</p> : null}

        <footer className="dialog-actions">
          <button className="ghost-action" disabled={isExporting} onClick={onClose} type="button">Cancel</button>
          <button className="primary-action" disabled={isExporting} type="submit">{isExporting ? "Exporting..." : "Choose destination"}</button>
        </footer>
      </form>
    </div>
  );
}

export default ExportDialog;
