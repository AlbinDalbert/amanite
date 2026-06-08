type StartScreenProps = {
  error: string | null;
  isBusy: boolean;
  onCreateProject: () => void;
  onOpenProject: () => void;
};

function StartScreen({ error, isBusy, onCreateProject, onOpenProject }: StartScreenProps) {
  return (
    <main className="start-screen">
      <section className="start-panel" aria-labelledby="start-title">
        <div className="start-brand">
          <span className="brand-mark" aria-hidden="true" />
          <p>Amanite</p>
        </div>

        <div className="start-copy">
          <h1 id="start-title">Open a Fractal project</h1>
          <p>
            Work with a local Fractal knowledge base, then let its own project
            files define how the page surface should feel.
          </p>
        </div>

        {error ? <p className="status-message error">{error}</p> : null}

        <div className="start-actions">
          <button
            className="primary-action"
            type="button"
            disabled={isBusy}
            onClick={onCreateProject}
          >
            Create new project
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isBusy}
            onClick={onOpenProject}
          >
            Open existing project
          </button>
        </div>
      </section>
    </main>
  );
}

export default StartScreen;
