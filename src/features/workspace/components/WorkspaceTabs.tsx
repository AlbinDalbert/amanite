import type { DragEvent } from "react";
import Icon from "@/components/ui/Icon";
import type { FractalProject } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import { folderPathFromTabId } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroup, type EditorGroupId } from "../workspaceGroups";

export const WORKSPACE_TAB_MIME = "application/x-amanite-workspace-tab";

export type DraggedWorkspaceTab = { groupId: EditorGroupId; path: string };

type Props = {
  buffers: Record<string, DocumentBuffer>;
  draggedTab: DraggedWorkspaceTab | null;
  focused: boolean;
  group: EditorGroup;
  project: FractalProject;
  onActivate: () => void;
  onCloseGroup?: () => void;
  onCloseTab: (groupId: EditorGroupId, path: string) => void;
  onDragEnd: () => void;
  onDragStart: (tab: DraggedWorkspaceTab) => void;
  onDropTab: (tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => void;
  onSelectTab: (groupId: EditorGroupId, path: string) => void;
  onSplitTab: (groupId: EditorGroupId, path: string) => void;
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

function WorkspaceTabs(props: Props) {
  function acceptDrop(event: DragEvent, index?: number) {
    const tab = parseDraggedTab(event, props.draggedTab);
    if (!tab) return;
    event.preventDefault();
    event.stopPropagation();
    props.onDropTab(tab, props.group.id, index);
  }

  return (
    <div
      className={`workspace-tab-strip${props.focused ? " focused" : ""}`}
      data-group-id={props.group.id}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
      }}
      onDrop={(event) => acceptDrop(event)}
      onMouseDown={(event) => event.stopPropagation()}
      onPointerDownCapture={props.onActivate}
    >
      <div aria-label="Open editor tabs" className="editor-group-tabs" role="tablist">
        {props.group.tabs.map((path, index) => {
          const borealis = path === BOREALIS_TAB_ID;
          const folderPath = folderPathFromTabId(path);
          const tabFolder = folderPath == null ? undefined : props.project.folders.find((candidate) => candidate.path === folderPath);
          const tabPage = props.project.pages.find((candidate) => candidate.path === path);
          const tabBuffer = props.buffers[path];
          const active = path === props.group.activePath;
          const title = borealis ? "Borealis" : tabFolder?.title || tabPage?.title?.trim() || path;
          return (
            <div
              className={`editor-group-tab${borealis ? " borealis" : ""}${tabFolder ? " folder" : ""} ${active ? "active" : ""}${tabBuffer?.conflict ? " conflict" : ""}`}
              draggable={!borealis || props.group.id === "right" || props.group.tabs.length > 1}
              key={path}
              onDragEnd={props.onDragEnd}
              onDragOver={(event) => {
                if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
              }}
              onDragStart={(event) => {
                const tab = { groupId: props.group.id, path };
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData(WORKSPACE_TAB_MIME, JSON.stringify(tab));
                props.onDragStart(tab);
              }}
              onDrop={(event) => acceptDrop(event, index)}
            >
              <button
                aria-selected={active}
                onClick={() => props.onSelectTab(props.group.id, path)}
                onKeyDown={(event) => {
                  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                  event.preventDefault();
                  const direction = event.key === "ArrowLeft" ? -1 : 1;
                  const nextIndex = Math.max(0, Math.min(index + direction, props.group.tabs.length - 1));
                  if (nextIndex === index) return;
                  const nextPath = props.group.tabs[nextIndex];
                  if (event.altKey && event.shiftKey) props.onDropTab({ groupId: props.group.id, path }, props.group.id, nextIndex);
                  else props.onSelectTab(props.group.id, nextPath);
                  const tablist = event.currentTarget.closest("[role='tablist']");
                  requestAnimationFrame(() => {
                    const tabs = tablist?.querySelectorAll<HTMLButtonElement>("button[role='tab']");
                    tabs?.[nextIndex]?.focus();
                  });
                }}
                role="tab"
                tabIndex={active ? 0 : -1}
                title={borealis ? "Borealis chat" : folderPath != null ? folderPath || "Pages" : path}
                type="button"
              >
                {borealis ? <span className="editor-group-tab-borealis-mark" aria-hidden="true"><i /><i /><i /></span> : null}
                <span className="editor-group-tab-title">{title}</span>
                {!borealis && !tabFolder ? <span className={`editor-group-tab-state${tabBuffer?.dirty ? " dirty" : ""}${tabBuffer?.conflict ? " conflict" : ""}`} aria-label={tabBuffer?.conflict ? "Changed on disk" : tabBuffer?.dirty ? "Unsaved" : "Saved"} /> : null}
              </button>
              {props.group.id === "left" && (!borealis || props.group.tabs.length > 1) ? <button aria-label={`Open ${title} in right group`} className="editor-group-tab-split" onClick={() => props.onSplitTab(props.group.id, path)} title="Open in right group" type="button"><Icon name="split" size={13} /></button> : null}
              <button aria-label={`Close ${title}`} className="editor-group-tab-close" onClick={() => props.onCloseTab(props.group.id, path)} type="button"><Icon name="close" size={13} /></button>
            </div>
          );
        })}
      </div>
      {props.onCloseGroup ? <button aria-label="Close editor group" className="editor-group-close" onClick={props.onCloseGroup} title="Close editor group" type="button"><Icon name="close" size={14} /></button> : null}
    </div>
  );
}

export default WorkspaceTabs;
