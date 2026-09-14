import DocumentLoadingPreview from "@/features/editor/components/DocumentLoadingPreview";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { FractalNativeSection, FractalProject } from "@/lib/fractal/types";
import type { FractalFolderHtmlExportOptions, FractalFolderHtmlExportReport, FractalHtmlExportReport } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import type { DocumentQueryIndex } from "../documentQueryIndex";
import { isFolderTab } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroup, type EditorGroupId } from "../workspaceGroups";
import { EditorGroupTabPanel, type EditorGroupTabPanelContext } from "./EditorGroupTabPanel";
import { acceptWorkspaceTabDrop, WORKSPACE_TAB_MIME, type DraggedWorkspaceTab } from "./WorkspaceTab";

type Props = {
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  buffer?: DocumentBuffer;
  buffers: Record<string, DocumentBuffer>;
  draggedTab: DraggedWorkspaceTab | null;
  documentQueries: DocumentQueryIndex;
  focused: boolean;
  focusMode: boolean;
  group: EditorGroup;
  isLoading: boolean;
  loadingPaths: Set<string>;
  loadErrors: Record<string, string>;
  workspaceBusy: boolean;
  loadError?: string;
  project: FractalProject;
  settings: AppearanceSettings;
  onActivate: () => void;
  onChangeSource: (path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onModelChange?: (path: string, snapshot: import("@/features/editor/components/editorModel").EditorModelSnapshot) => void;
  onRevision: (path: string) => void;
  onSnapshot?: (path: string, bodyHtml: string, revision: number) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onCreateFirstPage?: () => void;
  onDropTab: (tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => void;
  onExport: (path: string, includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport | null>;
  onExportFolder: (path: string, options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport | null>;
  onEnsurePage: (path: string) => Promise<boolean>;
  onOpenFolder: (groupId: EditorGroupId, path: string) => void;
  onNavigatePage: (groupId: EditorGroupId, path: string) => void;
  onOpenSettings: () => void;
  onReload: (path: string) => void;
  onRecreate: (path: string) => void;
  onReplace: (path: string) => void;
  onRepair: (path: string) => void;
  onRemoveMissing: (kind: "folder" | "native", path: string) => void;
  onReorderFolder: (path: string, order: string[]) => void;
  onSave: (path: string) => void;
  pageTitleIndex?: DocumentQueryIndex["titleIndex"];
  onSetFolderTitle: (path: string, title: string) => void;
  onToggleFocus: () => void;
  onToggleBorealis: () => void;
};

export function isDocumentWaitingForBuffer(activePath: string | null, hasBuffer: boolean, loadError?: string) {
  return Boolean(activePath && activePath !== BOREALIS_TAB_ID && !isFolderTab(activePath) && !hasBuffer && !loadError);
}

function EditorGroupEmptyState({ buffer, draggedTab, group, isWaiting, loadError, onCreateFirstPage, project }: { buffer?: DocumentBuffer; draggedTab: DraggedWorkspaceTab | null; group: EditorGroup; isWaiting: boolean; loadError?: string; onCreateFirstPage?: () => void; project: FractalProject }) {
  const isEmpty = !group.activePath
    || Boolean(!buffer && group.activePath !== BOREALIS_TAB_ID && !isFolderTab(group.activePath));
  if (!isEmpty || isWaiting) return null;
  return (
    <div className="editor-group-empty">
      <span>No document</span>
      <p>{loadError || (draggedTab ? "Drop a tab here" : "Open a page from the sidebar or quick open.")}</p>
      {!project.pages.length && onCreateFirstPage ? <button className="primary-action" onClick={onCreateFirstPage} type="button">Create page</button> : null}
    </div>
  );
}

function DocumentBufferAlert({ buffer, onRecreate, onReload, onReplace }: { buffer?: DocumentBuffer; onRecreate: Props["onRecreate"]; onReload: Props["onReload"]; onReplace: Props["onReplace"] }) {
  if (!buffer?.error) return null;
  return (
    <div className={`document-buffer-alert${buffer.conflict ? " conflict" : ""}`} role="alert">
      <div><strong>{buffer.conflict ? "Changed on disk" : "Save failed"}</strong><span>{buffer.error}</span></div>
      {buffer.conflict ? <div className="document-buffer-actions">{buffer.missing ? <button onClick={() => onRecreate(buffer.path)} type="button">Recreate page</button> : <><button onClick={() => onReload(buffer.path)} type="button">Reload disk</button><button className="danger" onClick={() => onReplace(buffer.path)} type="button">Replace disk</button></>}</div> : null}
    </div>
  );
}

function EditorGroupPane(props: Props) {
  const { buffer, group } = props;
  const isWaitingForBuffer = isDocumentWaitingForBuffer(group.activePath, Boolean(buffer), props.loadError);
  const tabPanelContext: EditorGroupTabPanelContext = {
    borealisOpen: props.borealisOpen,
    borealisWorkspace: props.borealisWorkspace,
    buffers: props.buffers,
    documentQueries: props.documentQueries,
    focusMode: props.focusMode,
    focused: props.focused,
    isLoading: props.isLoading,
    loadingPaths: props.loadingPaths,
    loadErrors: props.loadErrors,
    onChangeSource: props.onChangeSource,
    onModelChange: props.onModelChange,
    onRevision: props.onRevision,
    onSnapshot: props.onSnapshot,
    onCreateFolder: props.onCreateFolder,
    onCreatePage: props.onCreatePage,
    onEnsurePage: props.onEnsurePage,
    onExport: props.onExport,
    onExportFolder: props.onExportFolder,
    onNavigatePage: props.onNavigatePage,
    onOpenFolder: props.onOpenFolder,
    onOpenSettings: props.onOpenSettings,
    onRemoveMissing: props.onRemoveMissing,
    onRepair: props.onRepair,
    onReorderFolder: props.onReorderFolder,
    onSave: props.onSave,
    onSetFolderTitle: props.onSetFolderTitle,
    onToggleBorealis: props.onToggleBorealis,
    onToggleFocus: props.onToggleFocus,
    pages: props.project.pages,
    pageTitleIndex: props.pageTitleIndex,
    project: props.project,
    settings: props.settings,
    workspaceBusy: props.workspaceBusy
  };

  return (
    <section
      aria-label={`${group.id === "left" ? "Left" : "Right"} editor group`}
      className={`editor-group ${props.focused ? "focused" : ""}${props.draggedTab ? " accepts-tab" : ""}`}
      data-group-id={group.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
      }}
      onDrop={(event) => acceptWorkspaceTabDrop(event, props.draggedTab, group.id, props.onDropTab)}
      onPointerDownCapture={props.onActivate}
    >
      <div className="editor-group-body">
        {group.tabs.map((path) => <EditorGroupTabPanel active={path === group.activePath} context={tabPanelContext} groupId={group.id} key={path} path={path} />)}
        {group.activePath && isWaitingForBuffer ? <DocumentLoadingPreview title={props.project.pages.find((page) => page.path === group.activePath)?.title?.trim() || group.activePath} /> : null}
        <EditorGroupEmptyState buffer={buffer} draggedTab={props.draggedTab} group={group} isWaiting={isWaitingForBuffer} loadError={props.loadError} onCreateFirstPage={props.onCreateFirstPage} project={props.project} />
        <DocumentBufferAlert buffer={buffer} onRecreate={props.onRecreate} onReload={props.onReload} onReplace={props.onReplace} />
        {props.draggedTab ? <div className="editor-group-drop-cue"><span>Move to {group.id}</span></div> : null}
      </div>
    </section>
  );
}

export default EditorGroupPane;
