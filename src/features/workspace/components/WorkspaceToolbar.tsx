import type { FractalPageKind } from "@/lib/fractal/types";
import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";

type WorkspaceToolbarProps = {
  activePagePath?: string | null;
  activePageTitle?: string | null;
  activePageKind?: FractalPageKind;
  isBusy: boolean;
  saveState: "saved" | "saving" | "unsaved";
  onSave: () => void;
  onCloseRequest: () => void;
};

function WorkspaceToolbar({ activePageKind, activePagePath, activePageTitle, isBusy, saveState, onCloseRequest, onSave }: WorkspaceToolbarProps) {
  const title = activePageTitle?.trim() || activePagePath || "No page open";
  const saveLabel = saveState === "saving" ? "Saving" : saveState === "unsaved" ? "Unsaved" : "Saved";
  return (
    <header className="workspace-toolbar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
      <div className="workspace-tabstrip" role="tablist" aria-label="Open pages">
        <button aria-selected="true" className="workspace-tab active" role="tab" title={activePagePath ?? undefined} type="button">
          <span className="workspace-tab-title">{title}</span>
          {activePageKind ? <span className={`workspace-tab-kind ${activePageKind}`}>{activePageKind}</span> : null}
        </button>
      </div>
      <div className="workspace-save-controls">
        <span aria-live="polite" className={`save-state ${saveState}`}><i aria-hidden="true" />{saveLabel}</span>
        <button
          className="workspace-save-button"
          disabled={isBusy || saveState !== "unsaved"}
          onClick={onSave}
          title="Save page (Ctrl+S)"
          type="button"
        >
          Save
        </button>
      </div>
      <WindowControls onCloseRequest={onCloseRequest} />
    </header>
  );
}

export default WorkspaceToolbar;
