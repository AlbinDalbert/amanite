type WorkspaceToolbarProps = {
  isBusy: boolean;
  projectName: string;
  onBuildIndex: () => void;
  onValidate: () => void;
};

function WorkspaceToolbar({
  isBusy,
  projectName,
  onBuildIndex,
  onValidate
}: WorkspaceToolbarProps) {
  return (
    <header className="workspace-toolbar">
      <div>
        <p className="toolbar-kicker">Page</p>
        <h2>{projectName}</h2>
      </div>
      <div className="toolbar-actions">
        <button type="button" disabled={isBusy} onClick={onValidate}>
          Validate
        </button>
        <button type="button" disabled={isBusy} onClick={onBuildIndex}>
          Build index
        </button>
      </div>
    </header>
  );
}

export default WorkspaceToolbar;
