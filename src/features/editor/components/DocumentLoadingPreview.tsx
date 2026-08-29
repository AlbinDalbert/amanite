type Props = {
  title: string;
};

function DocumentLoadingPreview({ title }: Props) {
  return (
    <section aria-busy="true" aria-label={`Loading ${title}`} className="document-loading-preview">
      <div className="document-loading-toolbar" aria-hidden="true" />
      <div className="document-loading-canvas">
        <div className="document-loading-page">
          <h1>{title}</h1>
          <div className="document-loading-lines" aria-hidden="true">
            <i /><i /><i /><i /><i />
          </div>
        </div>
      </div>
    </section>
  );
}

export default DocumentLoadingPreview;
