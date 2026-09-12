import type { FractalProject } from "@/lib/fractal/types";
import type { DragEvent, KeyboardEvent } from "react";
import Icon from "@/components/ui/Icon";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import { folderPathFromTabId } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroup, type EditorGroupId } from "../workspaceGroups";

export const WORKSPACE_TAB_MIME = "application/x-amanite-workspace-tab";
export type DraggedWorkspaceTab = { groupId: EditorGroupId; path: string };

export type WorkspaceTabsProps = {
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

type WorkspaceTabProps = Omit<WorkspaceTabsProps, "focused" | "onActivate" | "onCloseGroup"> & {
  index: number;
  path: string;
};

export function acceptWorkspaceTabDrop(
  event: DragEvent,
  fallback: DraggedWorkspaceTab | null,
  groupId: EditorGroupId,
  onDropTab: WorkspaceTabsProps["onDropTab"],
  index?: number
) {
  const encoded = event.dataTransfer.getData(WORKSPACE_TAB_MIME);
  let tab = fallback;
  if (encoded) {
    try {
      tab = JSON.parse(encoded) as DraggedWorkspaceTab;
    } catch {
      // The in-memory drag state remains a valid fallback.
    }
  }
  if (!tab) return;
  event.preventDefault();
  event.stopPropagation();
  onDropTab(tab, groupId, index);
}

function workspaceTabPresentation(path: string, project: FractalProject, group: EditorGroup, buffers: WorkspaceTabProps["buffers"]) {
  const borealis = path === BOREALIS_TAB_ID;
  const folderPath = folderPathFromTabId(path);
  const tabFolder = folderPath == null ? undefined : project.folders.find((candidate) => candidate.path === folderPath);
  const tabPage = project.pages.find((candidate) => candidate.path === path);
  const tabBuffer = buffers[path];
  const active = path === group.activePath;
  const title = borealis ? "Borealis" : tabFolder?.title || tabPage?.title?.trim() || path;
  return { active, borealis, folderPath, tabBuffer, tabFolder, title };
}

function workspaceTabClassName(borealis: boolean, tabFolder: FractalProject["folders"][number] | undefined, active: boolean, conflict: boolean | undefined) {
  return `editor-group-tab${borealis ? " borealis" : ""}${tabFolder ? " folder" : ""} ${active ? "active" : ""}${conflict ? " conflict" : ""}`;
}

function canDragWorkspaceTab(borealis: boolean, group: EditorGroup) {
  return !borealis || group.id === "right" || group.tabs.length > 1;
}

function handleWorkspaceTabDragOver(event: DragEvent<HTMLDivElement>) {
  if (event.dataTransfer.types.includes(WORKSPACE_TAB_MIME)) event.preventDefault();
}

function handleWorkspaceTabDragStart(event: DragEvent<HTMLDivElement>, group: EditorGroup, path: string, onDragStart: WorkspaceTabProps["onDragStart"]) {
  const tab = { groupId: group.id, path };
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(WORKSPACE_TAB_MIME, JSON.stringify(tab));
  onDragStart(tab);
}

function handleTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, group: EditorGroup, path: string, index: number, onDropTab: WorkspaceTabProps["onDropTab"], onSelectTab: WorkspaceTabProps["onSelectTab"]) {
  if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  event.preventDefault();
  const direction = event.key === "ArrowLeft" ? -1 : 1;
  const nextIndex = Math.max(0, Math.min(index + direction, group.tabs.length - 1));
  if (nextIndex === index) return;
  const nextPath = group.tabs[nextIndex];
  if (event.altKey && event.shiftKey) onDropTab({ groupId: group.id, path }, group.id, nextIndex);
  else onSelectTab(group.id, nextPath);
  const tablist = event.currentTarget.closest("[role='tablist']");
  requestAnimationFrame(() => {
    tablist?.querySelectorAll<HTMLButtonElement>("button[role='tab']")[nextIndex]?.focus();
  });
}

function WorkspaceTabState({ tabBuffer }: { tabBuffer?: DocumentBuffer }) {
  if (!tabBuffer) return <span className="editor-group-tab-state" aria-label="Saved" />;
  if (tabBuffer.conflict) {
    const className = `editor-group-tab-state conflict${tabBuffer.dirty ? " dirty" : ""}`;
    return <span className={className} aria-label="Changed on disk" />;
  }
  return <span className={`editor-group-tab-state${tabBuffer.dirty ? " dirty" : ""}`} aria-label={tabBuffer.dirty ? "Unsaved" : "Saved"} />;
}

function WorkspaceTabButton({ active, borealis, folderPath, group, index, onDropTab, onSelectTab, path, tabBuffer, title }: {
  active: boolean;
  borealis: boolean;
  folderPath: string | null;
  group: EditorGroup;
  index: number;
  onDropTab: WorkspaceTabProps["onDropTab"];
  onSelectTab: WorkspaceTabProps["onSelectTab"];
  path: string;
  tabBuffer?: DocumentBuffer;
  title: string;
}) {
  const tabTitle = borealis ? "Borealis chat" : folderPath !== null ? folderPath || "Pages" : path;
  return (
    <button aria-selected={active} onClick={() => onSelectTab(group.id, path)} onKeyDown={(event) => handleTabKeyDown(event, group, path, index, onDropTab, onSelectTab)} role="tab" tabIndex={active ? 0 : -1} title={tabTitle} type="button">
      {borealis ? <span className="editor-group-tab-borealis-mark" aria-hidden="true"><i /><i /><i /></span> : null}
      <span className="editor-group-tab-title">{title}</span>
      {!borealis && folderPath === null ? <WorkspaceTabState tabBuffer={tabBuffer} /> : null}
    </button>
  );
}

export default function WorkspaceTab({ buffers, draggedTab, group, index, onCloseTab, onDragEnd, onDragStart, onDropTab, onSelectTab, onSplitTab, path, project }: WorkspaceTabProps) {
  const { active, borealis, folderPath, tabBuffer, tabFolder, title } = workspaceTabPresentation(path, project, group, buffers);
  return (
    <div
      className={workspaceTabClassName(borealis, tabFolder, active, tabBuffer?.conflict)}
      draggable={canDragWorkspaceTab(borealis, group)}
      onDragEnd={onDragEnd}
      onDragOver={handleWorkspaceTabDragOver}
      onDragStart={(event) => handleWorkspaceTabDragStart(event, group, path, onDragStart)}
      onDrop={(event) => acceptWorkspaceTabDrop(event, draggedTab, group.id, onDropTab, index)}
    >
      <WorkspaceTabButton active={active} borealis={borealis} folderPath={folderPath} group={group} index={index} onDropTab={onDropTab} onSelectTab={onSelectTab} path={path} tabBuffer={tabBuffer} title={title} />
      {group.id === "left" && (!borealis || group.tabs.length > 1) ? <button aria-label={`Open ${title} in right group`} className="editor-group-tab-split" onClick={() => onSplitTab(group.id, path)} title="Open in right group" type="button"><Icon name="split" size={13} /></button> : null}
      <button aria-label={`Close ${title}`} className="editor-group-tab-close" onClick={() => onCloseTab(group.id, path)} type="button"><Icon name="close" size={13} /></button>
    </div>
  );
}
