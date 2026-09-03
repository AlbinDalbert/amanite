import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";
import Icon from "@/components/ui/Icon";
import type { ReactNode } from "react";

type WorkspaceToolbarProps = {
  activeGroupLabel: string;
  canGoBack: boolean;
  canGoForward: boolean;
  dirtyCount: number;
  isSaving: boolean;
  onBack: () => void;
  onCloseRequest: () => void;
  onForward: () => void;
  onOpenQuick: () => void;
  onToggleSidebar: () => void;
  tabs: ReactNode;
};

function WorkspaceToolbar(props: WorkspaceToolbarProps) {
  const saveLabel = props.isSaving ? "Saving" : props.dirtyCount ? `${props.dirtyCount} unsaved` : "Saved";
  return (
    <header className="workspace-toolbar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
      <div className="workspace-nav-controls">
        <button onClick={props.onToggleSidebar} title="Toggle sidebar (Ctrl+B)" type="button"><Icon name="menu" /></button>
        <button disabled={!props.canGoBack} onClick={props.onBack} title={`Back in ${props.activeGroupLabel}`} type="button"><Icon name="arrow-left" /></button>
        <button disabled={!props.canGoForward} onClick={props.onForward} title={`Forward in ${props.activeGroupLabel}`} type="button"><Icon name="arrow-right" /></button>
        <button onClick={props.onOpenQuick} title={`Quick open in ${props.activeGroupLabel} (Ctrl+P)`} type="button"><Icon name="search" /></button>
      </div>
      <div className="workspace-tabs">{props.tabs}</div>
      <span aria-live="polite" className={`workspace-save-status save-state ${props.isSaving ? "saving" : props.dirtyCount ? "unsaved" : "saved"}`}>{saveLabel}</span>
      <WindowControls onCloseRequest={props.onCloseRequest} />
    </header>
  );
}

export default WorkspaceToolbar;
