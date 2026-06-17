import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";

type WorkspaceToolbarProps = {
  activePagePath: string;
  activePageTitle: string;
};

function pageTabTitle(title: string, pagePath: string) {
  const trimmedTitle = title.trim();

  if (trimmedTitle) {
    return trimmedTitle;
  }

  const pathParts = pagePath.split("/").filter(Boolean);
  const fileName = pathParts[pathParts.length - 1] ?? pagePath;
  return fileName.replace(/\.html?$/i, "") || "Untitled";
}

function WorkspaceToolbar({ activePagePath, activePageTitle }: WorkspaceToolbarProps) {
  return (
    <header
      className="workspace-toolbar"
      data-tauri-drag-region
      onMouseDown={handleWindowDragMouseDown}
    >
      <div className="workspace-tabstrip" role="tablist" aria-label="Open pages">
        <button
          aria-selected="true"
          className="workspace-tab active"
          role="tab"
          title={activePagePath}
          type="button"
        >
          <span className="workspace-tab-title">{pageTabTitle(activePageTitle, activePagePath)}</span>
        </button>
      </div>

      <WindowControls />
    </header>
  );
}

export default WorkspaceToolbar;
