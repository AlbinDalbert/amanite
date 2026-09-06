import type { DragEvent } from "react";
import BorealisChat from "@/features/ai-chat/components/AiChat";
import DocumentLoadingPreview from "@/features/editor/components/DocumentLoadingPreview";
import FractalEditor from "@/features/editor/components/FractalEditor";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { AiSettings } from "@/app/useAiSettings";
import type { FractalNativeSection, FractalProject } from "@/lib/fractal/types";
import type { FractalFolderHtmlExportOptions, FractalFolderHtmlExportReport, FractalHtmlExportReport } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import { folderPathFromTabId, isFolderTab } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroup, type EditorGroupId } from "../workspaceGroups";
import FolderView from "./FolderView";
import { WORKSPACE_TAB_MIME, type DraggedWorkspaceTab } from "./WorkspaceTabs";

type Props = {
  aiSettings: AiSettings;
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  buffer?: DocumentBuffer;
  buffers: Record<string, DocumentBuffer>;
  draggedTab: DraggedWorkspaceTab | null;
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
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onCreateFirstPage?: () => void;
  onCloseGroup?: () => void;
  onCloseTab: (groupId: EditorGroupId, path: string) => void;
  onDragEnd: () => void;
  onDragStart: (tab: DraggedWorkspaceTab) => void;
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
  onSelectTab: (groupId: EditorGroupId, path: string) => void;
  onSplitTab: (groupId: EditorGroupId, path: string) => void;
  onSetFolderTitle: (path: string, title: string) => void;
  onToggleFocus: () => void;
  onToggleBorealis: () => void;
};

function parseDraggedTab(event: DragEvent, fallback: DraggedWorkspaceTab | null) {
  const encoded = event.dataTransfer.getData(WORKSPACE_TAB_MIME);
  if (!encoded) return fallback;
  try {
    return JSON.parse(encoded) as DraggedWorkspaceTab;
  } catch {
    return fallback;
  }
}

export function isDocumentWaitingForBuffer(activePath: string | null, hasBuffer: boolean, loadError?: string) {
  return Boolean(activePath && activePath !== BOREALIS_TAB_ID && !isFolderTab(activePath) && !hasBuffer && !loadError);
}

function EditorGroupPane(props: Props) {
  const { buffer, group } = props;
  const isWaitingForBuffer = isDocumentWaitingForBuffer(group.activePath, Boolean(buffer), props.loadError);

  function acceptDrop(event: DragEvent, index?: number) {
    const tab = parseDraggedTab(event, props.draggedTab);
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    props.onDropTab(tab, group.id, index);
  }

  return (
    <section
      aria-label={`${group.id === "left" ? "Left" : "Right"} editor group`}
      className={`editor-group ${props.focused ? "focused" : ""}${props.draggedTab ? " accepts-tab" : ""}`}
      data-group-id={group.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
      }}
      onDrop={(event) => acceptDrop(event)}
      onPointerDownCapture={props.onActivate}
    >
      <div className="editor-group-body">
        {group.tabs.map((path) => {
          const active = path === group.activePath;
          if (path === BOREALIS_TAB_ID) {
            return (
              <div className={active ? "editor-tab-panel active borealis-tab-panel" : "editor-tab-panel borealis-tab-panel"} hidden={!active} key={path} role="tabpanel">
                <BorealisChat onOpenSettings={props.onOpenSettings} presentation="workspace" showTrigger={false} />
              </div>
            );
          }
          const folderPath = folderPathFromTabId(path);
          if (folderPath != null) {
            const folder = props.project.folders.find((candidate) => candidate.path === folderPath);
            if (!folder) return null;
            return (
              <div className={active ? "editor-tab-panel active" : "editor-tab-panel"} hidden={!active} key={path} role="tabpanel">
                <FolderView
                  borealisOpen={props.borealisOpen}
                  borealisWorkspace={props.borealisWorkspace}
                  buffers={props.buffers}
                  folder={folder}
                  focusMode={props.focusMode}
                  folders={props.project.folders}
                  isBusy={props.workspaceBusy}
                  loadingPaths={props.loadingPaths}
                  loadErrors={props.loadErrors}
                  pages={props.project.pages}
                  projectName={props.project.name}
                  spellCheck={props.settings.spellCheck}
                  onChangeSource={props.onChangeSource}
                  onCreateFolder={props.onCreateFolder}
                  onCreatePage={props.onCreatePage}
                  onEnsurePage={props.onEnsurePage}
                  onExport={(options) => props.onExportFolder(folderPath, options)}
                  onOpenFolder={(nextPath) => props.onOpenFolder(group.id, nextPath)}
                  onOpenPage={(nextPath) => props.onNavigatePage(group.id, nextPath)}
                  onRemoveMissing={props.onRemoveMissing}
                  onReorder={(order) => props.onReorderFolder(folderPath, order)}
                  onSavePage={props.onSave}
                  onSetTitle={(title) => props.onSetFolderTitle(folderPath, title)}
                  onToggleBorealis={props.onToggleBorealis}
                  onToggleFocus={props.onToggleFocus}
                />
              </div>
            );
          }
          const tabBuffer = props.buffers[path];
          const tabPage = props.project.pages.find((candidate) => candidate.path === path);
          if (!tabBuffer || !tabPage) return null;
          return (
            <div className={active ? "editor-tab-panel active" : "editor-tab-panel"} hidden={!active} key={path} role="tabpanel">
              <FractalEditor
                borealisOpen={props.borealisOpen}
                borealisWorkspace={props.borealisWorkspace}
                backlinks={tabBuffer.backlinks}
                focusMode={props.focusMode}
                isBusy={props.workspaceBusy || (active && props.isLoading)}
                isFractalValid={Boolean(tabBuffer.nativeDocumentParts)}
                links={tabBuffer.links}
                pages={props.project.pages}
                pagePath={path}
                projectName={props.project.name}
                source={tabBuffer.source}
                spellCheck={props.settings.spellCheck}
                wordGoal={props.settings.wordGoal}
                onChangeSource={(source, nativeSection) => props.onChangeSource(path, source, nativeSection)}
                onExport={(includeDerivedLinks) => props.onExport(path, includeDerivedLinks)}
                onNavigatePage={(nextPath) => props.onNavigatePage(group.id, nextPath)}
                onOpenFolder={(folderPath) => props.onOpenFolder(group.id, folderPath)}
                onRepair={() => props.onRepair(path)}
                onSave={() => props.onSave(path)}
                onToggleFocus={props.onToggleFocus}
                onToggleBorealis={props.onToggleBorealis}
              />
            </div>
          );
        })}
        {group.activePath && isWaitingForBuffer ? (
          <DocumentLoadingPreview
            title={props.project.pages.find((page) => page.path === group.activePath)?.title?.trim() || group.activePath}
          />
        ) : null}
        {(!group.activePath || (!buffer && group.activePath !== BOREALIS_TAB_ID && !isFolderTab(group.activePath))) ? (
          isWaitingForBuffer ? null : (
            <div className="editor-group-empty">
              <span>No document</span>
              <p>{props.loadError || (props.draggedTab ? "Drop a tab here" : "Open a page from the sidebar or quick open.")}</p>
              {!props.project.pages.length && props.onCreateFirstPage ? <button className="primary-action" onClick={props.onCreateFirstPage} type="button">Create page</button> : null}
            </div>
          )
        ) : null}
        {buffer?.error ? (
          <div className={`document-buffer-alert${buffer.conflict ? " conflict" : ""}`} role="alert">
            <div><strong>{buffer.conflict ? "Changed on disk" : "Save failed"}</strong><span>{buffer.error}</span></div>
            {buffer.conflict ? <div className="document-buffer-actions">{buffer.missing ? <button onClick={() => props.onRecreate(buffer.path)} type="button">Recreate page</button> : <><button onClick={() => props.onReload(buffer.path)} type="button">Reload disk</button><button className="danger" onClick={() => props.onReplace(buffer.path)} type="button">Replace disk</button></>}</div> : null}
          </div>
        ) : null}
        {props.draggedTab ? <div className="editor-group-drop-cue"><span>Move to {group.id}</span></div> : null}
      </div>
    </section>
  );
}

export default EditorGroupPane;
