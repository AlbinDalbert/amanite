import type { FractalPageKind } from "@/lib/fractal/types";
import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";

type WorkspaceToolbarProps = {
  activePagePath?: string | null;
  activePageTitle?: string | null;
  activePageKind?: FractalPageKind;
};

function WorkspaceToolbar({ activePageKind, activePagePath, activePageTitle }: WorkspaceToolbarProps) {
  const title = activePageTitle?.trim() || activePagePath || "No page open";
  return (
    <header className="workspace-toolbar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
      <div className="workspace-tabstrip" role="tablist" aria-label="Open pages">
        <button aria-selected="true" className="workspace-tab active" role="tab" title={activePagePath ?? undefined} type="button">
          <span className="workspace-tab-title">{title}</span>
          {activePageKind ? <span className={`workspace-tab-kind ${activePageKind}`}>{activePageKind}</span> : null}
        </button>
      </div>
      <WindowControls />
    </header>
  );
}

export default WorkspaceToolbar;
