type Props = {
  isBusy: boolean;
  pagePath: string;
  source: string;
  onChangeSource: (source: string) => void;
  onPreview: () => void;
  onToggleInspector: () => void;
};

function RawHtmlEditor({ isBusy, pagePath, source, onChangeSource, onPreview, onToggleInspector }: Props) {
  return (
    <section className="raw-source-shell" aria-label="Raw HTML source editor">
      <header className="raw-source-header">
        <div>
          <span className="document-kind-badge raw">Raw HTML</span>
          <p>Fractal inspects this file but leaves its source under your control.</p>
        </div>
        <div className="rendered-page-actions">
          <button className="editor-inspector-toggle" onClick={onToggleInspector} type="button">Links</button>
          <button className="source-mode-toggle" onClick={onPreview} type="button">Preview</button>
        </div>
      </header>
      <label className="raw-source-field">
        <span>{pagePath}</span>
        <textarea
          aria-label={`Source for ${pagePath}`}
          disabled={isBusy}
          onChange={(event) => onChangeSource(event.currentTarget.value)}
          spellCheck={false}
          value={source}
        />
      </label>
    </section>
  );
}

export default RawHtmlEditor;
