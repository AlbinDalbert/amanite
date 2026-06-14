type WorkspaceToolbarProps = {
  projectName: string;
};

function WorkspaceToolbar({ projectName }: WorkspaceToolbarProps) {
  return (
    <header className="workspace-toolbar">
      <div>
        <p className="toolbar-kicker">Page</p>
        <h2>{projectName}</h2>
      </div>
    </header>
  );
}

export default WorkspaceToolbar;
