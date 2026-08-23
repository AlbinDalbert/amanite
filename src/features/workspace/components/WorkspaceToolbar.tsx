import type { FractalPage, FractalPageKind } from "@/lib/fractal/types";
import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";

type WorkspaceToolbarProps = {
  activePagePath?: string | null;
  activePageTitle?: string | null;
  activePageKind?: FractalPageKind;
  canGoBack: boolean;
  canGoForward: boolean;
  externalChangeDetected: boolean;
  isBusy: boolean;
  openPages: FractalPage[];
  secondaryPagePath?: string | null;
  saveState: "saved" | "saving" | "unsaved";
  onBack: () => void;
  onCloseRequest: () => void;
  onCloseTab: (path: string) => void;
  onForward: () => void;
  onOpenQuick: () => void;
  onReload: () => void;
  onSave: () => void;
  onSelectTab: (path: string) => void;
  onSplitTab: (path: string) => void;
  onTabDragEnd: () => void;
  onTabDragStart: (path: string) => void;
  onToggleSidebar: () => void;
};

function WorkspaceToolbar(props: WorkspaceToolbarProps) {
  const title = props.activePageTitle?.trim() || props.activePagePath || "No page open";
  const saveLabel = props.saveState === "saving" ? "Saving" : props.saveState === "unsaved" ? "Unsaved" : "Saved";
  return (
    <header className="workspace-toolbar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
      <div className="workspace-nav-controls">
        <button onClick={props.onToggleSidebar} title="Toggle sidebar (Ctrl+B)" type="button">☰</button>
        <button disabled={!props.canGoBack} onClick={props.onBack} title="Back" type="button">←</button>
        <button disabled={!props.canGoForward} onClick={props.onForward} title="Forward" type="button">→</button>
        <button onClick={props.onOpenQuick} title="Quick open (Ctrl+P)" type="button">⌕</button>
      </div>
      <div className="workspace-tabstrip" role="tablist" aria-label="Open pages">
        {props.openPages.length ? props.openPages.map((page) => (
          <div className={`${page.path === props.activePagePath ? "workspace-tab active" : "workspace-tab"}${page.path === props.secondaryPagePath ? " secondary" : ""}`} draggable onDragEnd={props.onTabDragEnd} onDragStart={(event) => { event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-amanite-tab", page.path); props.onTabDragStart(page.path); }} key={page.path}>
            <button aria-selected={page.path === props.activePagePath} onClick={() => props.onSelectTab(page.path)} role="tab" title={page.path} type="button">
              <span className="workspace-tab-title">{page.title?.trim() || page.path}</span>
              <span className={`workspace-tab-kind ${page.kind}`}>{page.kind === "native" ? "F" : "HTML"}</span>
            </button>
            <button aria-label={`Open ${page.title || page.path} beside the active page`} className="workspace-tab-split" onClick={() => props.onSplitTab(page.path)} title="Open beside" type="button">◫</button>
            <button aria-label={`Close ${page.title || page.path}`} className="workspace-tab-close" onClick={() => props.onCloseTab(page.path)} type="button">×</button>
          </div>
        )) : <span className="workspace-empty-tab">{title}</span>}
      </div>
      <div className="workspace-save-controls">
        {props.externalChangeDetected ? <button className="external-reload" onClick={props.onReload} type="button">Reload disk change</button> : null}
        <span aria-live="polite" className={`save-state ${props.saveState}`}><i aria-hidden="true" />{saveLabel}</span>
        <button className="workspace-save-button" disabled={props.isBusy || props.saveState !== "unsaved"} onClick={props.onSave} title="Save page (Ctrl+S)" type="button">Save</button>
      </div>
      <WindowControls onCloseRequest={props.onCloseRequest} />
    </header>
  );
}

export default WorkspaceToolbar;
