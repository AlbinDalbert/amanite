import type { DragEvent } from "react";
import Icon from "@/components/ui/Icon";
import FractalEditor from "@/features/editor/components/FractalEditor";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { FractalProject } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import type { EditorGroup, EditorGroupId } from "../workspaceGroups";

export const WORKSPACE_TAB_MIME = "application/x-amanite-workspace-tab";

export type DraggedWorkspaceTab = { groupId: EditorGroupId; path: string };

type Props = {
  buffer?: DocumentBuffer;
  buffers: Record<string, DocumentBuffer>;
  draggedTab: DraggedWorkspaceTab | null;
  focused: boolean;
  focusMode: boolean;
  group: EditorGroup;
  isLoading: boolean;
  loadError?: string;
  project: FractalProject;
  settings: AppearanceSettings;
  onActivate: () => void;
  onChangeSource: (path: string, source: string) => void;
  onCreateFirstPage?: () => void;
  onCloseGroup?: () => void;
  onCloseTab: (groupId: EditorGroupId, path: string) => void;
  onDragEnd: () => void;
  onDragStart: (tab: DraggedWorkspaceTab) => void;
  onDropTab: (tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => void;
  onNavigatePage: (groupId: EditorGroupId, path: string) => void;
  onReload: (path: string) => void;
  onReplace: (path: string) => void;
  onSave: (path: string) => void;
  onSelectTab: (groupId: EditorGroupId, path: string) => void;
  onSplitTab: (groupId: EditorGroupId, path: string) => void;
  onToggleFocus: () => void;
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

function EditorGroupPane(props: Props) {
  const { buffer, group } = props;

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
      <header className="editor-group-header">
        <span className="editor-group-label">{group.id}</span>
        <div aria-label={`${group.id} editor tabs`} className="editor-group-tabs" role="tablist">
          {group.tabs.map((path, index) => {
            const tabPage = props.project.pages.find((candidate) => candidate.path === path);
            const tabBuffer = props.buffers[path];
            const active = path === group.activePath;
            return (
              <div
                className={`editor-group-tab ${active ? "active" : ""}${tabBuffer?.conflict ? " conflict" : ""}`}
                draggable
                key={path}
                onDragEnd={props.onDragEnd}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
                }}
                onDragStart={(event) => {
                  const tab = { groupId: group.id, path };
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(WORKSPACE_TAB_MIME, JSON.stringify(tab));
                  props.onDragStart(tab);
                }}
                onDrop={(event) => acceptDrop(event, index)}
              >
                <button
                  aria-selected={active}
                  onClick={() => props.onSelectTab(group.id, path)}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                    event.preventDefault();
                    const direction = event.key === "ArrowLeft" ? -1 : 1;
                    const nextIndex = Math.max(0, Math.min(index + direction, group.tabs.length - 1));
                    if (nextIndex === index) return;
                    const nextPath = group.tabs[nextIndex];
                    if (event.altKey && event.shiftKey) props.onDropTab({ groupId: group.id, path }, group.id, nextIndex);
                    else props.onSelectTab(group.id, nextPath);
                    const tablist = event.currentTarget.closest("[role='tablist']");
                    requestAnimationFrame(() => {
                      const tabs = tablist?.querySelectorAll<HTMLButtonElement>("button[role='tab']");
                      tabs?.[nextIndex]?.focus();
                    });
                  }}
                  role="tab"
                  tabIndex={active ? 0 : -1}
                  title={path}
                  type="button"
                >
                  <span className="editor-group-tab-title">{tabPage?.title?.trim() || path}</span>
                  <span className={`editor-group-tab-state${tabBuffer?.dirty ? " dirty" : ""}${tabBuffer?.conflict ? " conflict" : ""}`} aria-label={tabBuffer?.conflict ? "Changed on disk" : tabBuffer?.dirty ? "Unsaved" : "Saved"} />
                </button>
                {group.id === "left" ? <button aria-label={`Open ${tabPage?.title || path} in right group`} className="editor-group-tab-split" onClick={() => props.onSplitTab(group.id, path)} title="Open in right group" type="button"><Icon name="split" size={13} /></button> : null}
                <button aria-label={`Close ${tabPage?.title || path}`} className="editor-group-tab-close" onClick={() => props.onCloseTab(group.id, path)} type="button"><Icon name="close" size={13} /></button>
              </div>
            );
          })}
        </div>
        <span className="editor-group-count">{group.tabs.length}</span>
        {props.onCloseGroup ? <button aria-label={`Close ${group.id} editor group`} className="editor-group-close" onClick={props.onCloseGroup} title="Close editor group" type="button"><Icon name="close" size={14} /></button> : null}
      </header>

      <div className="editor-group-body">
        {group.tabs.map((path) => {
          const tabBuffer = props.buffers[path];
          const tabPage = props.project.pages.find((candidate) => candidate.path === path);
          if (!tabBuffer || !tabPage) return null;
          const active = path === group.activePath;
          return (
            <div className={active ? "editor-tab-panel active" : "editor-tab-panel"} hidden={!active} key={path} role="tabpanel">
              <FractalEditor
                backlinks={tabBuffer.backlinks}
                focusMode={props.focusMode}
                isBusy={tabBuffer.operation !== null || (active && props.isLoading)}
                iframeBacklinks={tabBuffer.iframeBacklinks}
                iframes={tabBuffer.iframes}
                kind={tabPage.kind}
                links={tabBuffer.links}
                pages={props.project.pages}
                pagePath={path}
                source={tabBuffer.source}
                spellCheck={props.settings.spellCheck}
                wordGoal={props.settings.wordGoal}
                onChangeSource={(source) => props.onChangeSource(path, source)}
                onNavigatePage={(nextPath) => props.onNavigatePage(group.id, nextPath)}
                onSave={() => props.onSave(path)}
                onToggleFocus={props.onToggleFocus}
              />
            </div>
          );
        })}
        {!buffer || !group.activePath ? (
          <div className="editor-group-empty">
            <span>{props.isLoading ? "Opening document" : "No document"}</span>
            <p>{props.loadError || (props.draggedTab ? "Drop a tab here" : "Open a page from the sidebar or quick open.")}</p>
            {!props.project.pages.length && props.onCreateFirstPage ? <button className="primary-action" onClick={props.onCreateFirstPage} type="button">Create page</button> : null}
          </div>
        ) : null}
        {buffer?.error ? (
          <div className={`document-buffer-alert${buffer.conflict ? " conflict" : ""}`} role="alert">
            <div><strong>{buffer.conflict ? "Changed on disk" : "Save failed"}</strong><span>{buffer.error}</span></div>
            {buffer.conflict ? <div className="document-buffer-actions"><button onClick={() => props.onReload(buffer.path)} type="button">Reload disk</button><button className="danger" onClick={() => props.onReplace(buffer.path)} type="button">Replace disk</button></div> : null}
          </div>
        ) : null}
        {props.draggedTab ? <div className="editor-group-drop-cue"><span>Move to {group.id}</span></div> : null}
      </div>
    </section>
  );
}

export default EditorGroupPane;
