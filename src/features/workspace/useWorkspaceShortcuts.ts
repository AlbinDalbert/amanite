import { useEffect, type Dispatch, type SetStateAction } from "react";
import { isFolderTab } from "./folderTabs";
import {
  BOREALIS_TAB_ID,
  tabPathForDirection,
  tabPathForShortcut,
  type EditorGroup,
  type EditorGroupId,
  type WorkspaceGroups
} from "./workspaceGroups";

type ClosedTab = { groupId: EditorGroupId; path: string };

export type WorkspaceShortcutContext = {
  activeGroup: EditorGroup;
  closeTab: (groupId: EditorGroupId, path: string) => Promise<void>;
  closedTabs: ClosedTab[];
  createPage: (title: string) => Promise<void>;
  documents: {
    saveAll: () => Promise<boolean>;
    saveDocument: (path: string) => Promise<boolean>;
  };
  groupsRef: { current: WorkspaceGroups };
  openInGroup: (groupId: EditorGroupId, path: string) => Promise<void>;
  setClosedTabs: Dispatch<SetStateAction<ClosedTab[]>>;
  setQuickOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

type ShortcutHandler = (
  event: KeyboardEvent,
  key: string,
  context: WorkspaceShortcutContext
) => boolean;

function handleTabShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  const path = key === "tab" && !event.altKey
    ? tabPathForDirection(context.activeGroup, event.shiftKey ? -1 : 1)
    : !event.altKey && !event.shiftKey
      ? tabPathForShortcut(context.activeGroup, key)
      : null;
  if (!path) return false;
  event.preventDefault();
  void context.openInGroup(context.activeGroup.id, path);
  return true;
}

function handleSaveShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  if (key !== "s") return false;
  if (event.defaultPrevented) return true;
  event.preventDefault();
  const path = context.activeGroup.activePath;
  if (path && isFolderTab(path)) void context.documents.saveAll();
  else if (path && path !== BOREALIS_TAB_ID) void context.documents.saveDocument(path);
  return true;
}

function handlePanelShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  if (key === "p" || (key === "f" && event.shiftKey)) {
    event.preventDefault();
    context.setQuickOpen(true);
    return true;
  }
  if (key === "b") {
    event.preventDefault();
    context.setSidebarOpen((open) => !open);
    return true;
  }
  return false;
}

function handlePageShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  if (key !== "n") return false;
  event.preventDefault();
  void context.createPage("Untitled");
  return true;
}

function handleCloseShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  if (key !== "w" || !context.activeGroup.activePath) return false;
  event.preventDefault();
  void context.closeTab(context.activeGroup.id, context.activeGroup.activePath);
  return true;
}

function handleRestoreShortcut(event: KeyboardEvent, key: string, context: WorkspaceShortcutContext) {
  if (key !== "t" || !event.shiftKey) return false;
  const tab = context.closedTabs.at(-1);
  if (!tab) return true;
  event.preventDefault();
  context.setClosedTabs((tabs) => tabs.slice(0, -1));
  const groupId = tab.groupId === "right" && !context.groupsRef.current.right ? "left" : tab.groupId;
  void context.openInGroup(groupId, tab.path);
  return true;
}

const shortcutHandlers: ShortcutHandler[] = [
  handleTabShortcut,
  handleSaveShortcut,
  handlePanelShortcut,
  handlePageShortcut,
  handleCloseShortcut,
  handleRestoreShortcut
];

function handleWorkspaceShortcut(event: KeyboardEvent, context: WorkspaceShortcutContext) {
  if (!(event.metaKey || event.ctrlKey)) return;
  const key = event.key.toLowerCase();
  for (const handler of shortcutHandlers) {
    if (handler(event, key, context)) return;
  }
}

export function useWorkspaceShortcuts(context: WorkspaceShortcutContext) {
  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => handleWorkspaceShortcut(event, context);
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    context.activeGroup.activePath,
    context.activeGroup.id,
    context.activeGroup.tabs,
    context.closeTab,
    context.closedTabs,
    context.createPage,
    context.documents.saveAll,
    context.documents.saveDocument,
    context.groupsRef,
    context.openInGroup,
    context.setClosedTabs,
    context.setQuickOpen,
    context.setSidebarOpen
  ]);
}
