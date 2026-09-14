import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps, type CSSProperties, type Dispatch, type PointerEvent, type SetStateAction } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { startPointerResize } from "@/components/ui/pointerResize";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { AiSettings } from "@/app/useAiSettings";
import BorealisChat, { BorealisSessionProvider } from "@/features/ai-chat/components/AiChat";
import type { FractalCommandResult, FractalFolderHtmlExportOptions, FractalMutationBatchResult, FractalMutationResult, FractalProject, FractalSearchResult } from "@/lib/fractal/types";
import { createdPagePath, mapPagePath, reconcileMutationBatch, reconcileMutationResult } from "@/lib/fractal/reconcile";
import { reconcilePageDrafts } from "@/app/pageDrafts";
import { fractalClient } from "@/lib/fractal/client";
import { useWorkspaceDocuments } from "../useWorkspaceDocuments";
import type { DocumentQueryIndex } from "../documentQueryIndex";
import { folderPathFromTabId, folderTabId, isFolderTab } from "../folderTabs";
import { useWorkspaceShortcuts } from "../useWorkspaceShortcuts";
import {
  activateGroup,
  BOREALIS_TAB_ID,
  closeGroupTab,
  createProjectOverviewGroups,
  groupForPath,
  mapWorkspacePath,
  moveGroupTab,
  navigateGroupHistory,
  openGroupTab,
  reconcileWorkspacePaths,
  reconcileWorkspaceGroups,
  renameGroupTab,
  type EditorGroupId,
  type WorkspaceGroups
} from "../workspaceGroups";
import CommandStatus from "./CommandStatus";
import EditorGroupPane from "./EditorGroupPane";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";
import WorkspaceTabs, { type DraggedWorkspaceTab } from "./WorkspaceTabs";

type ProjectMutation = Promise<FractalMutationResult | null | undefined>;
type ProjectBatchMutation = Promise<FractalMutationBatchResult | null | undefined>;

function validWorkspaceTabs(project: FractalProject) {
  return new Set([...project.pages.map((page) => page.path), ...project.folders.map((folder) => folderTabId(folder.path)), BOREALIS_TAB_ID]);
}

type WorkspaceProps = {
  aiSettings: AiSettings;
  commandResult: FractalCommandResult | null;
  error: string | null;
  isBusy: boolean;
  project: FractalProject;
  projectGeneration?: number;
  settings: AppearanceSettings;
  onCloseProject: () => void;
  onCloseRequest: () => void;
  onCreatePage: (title: string, folderPath?: string) => ProjectMutation;
  onCreateFolder: (folderPath: string) => ProjectMutation;
  onSetFolderTitle: (folderPath: string, title: string) => ProjectMutation;
  onReorderFolder: (folderPath: string, order: string[]) => ProjectMutation;
  onDeletePage: (pagePath: string) => ProjectMutation;
  onDeleteFolder: (folderPath: string) => ProjectMutation;
  onDismissStatus: () => void;
  onDuplicatePage: (pagePath: string) => ProjectBatchMutation;
  onRepairPage: (pagePath: string) => ProjectMutation;
  onMovePage: (pagePath: string, destinationFolder: string) => ProjectMutation;
  onOpenSettings: () => void;
  onProjectSnapshot: (project: FractalProject) => void;
  onRegisterWorkspace: (dirty: boolean, save: (() => Promise<boolean>) | null) => void;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  onRevealPage: (pagePath?: string) => void;
  onValidate: () => void;
};

function QuickOpen({ documentQueries, onClose, onOpen }: {
  documentQueries: DocumentQueryIndex;
  onClose: () => void;
  onOpen: (path: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FractalSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    let disposed = false;
    const timeout = window.setTimeout(() => {
      if (!disposed) setResults(documentQueries.search(query));
    }, 120);
    return () => { disposed = true; window.clearTimeout(timeout); };
  }, [documentQueries, query]);

  return (
    <div className="modal-backdrop quick-open-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-label="Quick open" aria-modal="true" className="quick-open" role="dialog">
        <header><span>Quick open</span><kbd>Ctrl P</kbd></header>
        <input
          aria-label="Search project"
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && results[0]) { onOpen(results[0].path); onClose(); }
          }}
          placeholder="Search titles and page text"
          ref={inputRef}
          value={query}
        />
        <ul>{results.slice(0, 30).map((result) => <li key={result.path}><button onClick={() => { onOpen(result.path); onClose(); }} type="button"><strong>{result.title || result.path}</strong><small>{result.snippet || result.path}</small><code>{result.path}</code></button></li>)}</ul>
        {!results.length ? <p>No matching pages.</p> : null}
      </section>
    </div>
  );
}

type WorkspaceDocuments = ReturnType<typeof useWorkspaceDocuments>;

function useWorkspaceMutationReconciliation(documents: WorkspaceDocuments, setClosedTabs: Dispatch<SetStateAction<Array<{ groupId: EditorGroupId; path: string }>>>, setGroups: Dispatch<SetStateAction<WorkspaceGroups>>) {
  const applyMutation = useCallback(async (mutation: FractalMutationResult) => {
    const reconciled = reconcileMutationResult(documents.project, mutation);
    const { result, scope } = reconciled;
    if (mutation.receipt.changes.length) await reconcilePageDrafts(result.project.rootPath, scope.mappings);
    for (const path of Object.keys(documents.buffers)) {
      const nextPath = mapPagePath(path, scope.mappings);
      if (nextPath !== path) documents.renameDocument(path, nextPath);
    }
    setGroups((current) => reconcileWorkspacePaths(current, scope.mappings));
    setClosedTabs((current) => current.map((tab) => ({ ...tab, path: mapWorkspacePath(tab.path, scope.mappings) })));
    documents.publishProject(result.project);
    const deletedPaths = Object.keys(documents.buffers).filter((path) =>
      scope.mappings.deletedPages.has(path)
      || Array.from(scope.mappings.deletedFolders).some((folder) => path.startsWith(`${folder}/`))
    );
    await documents.refreshChangedDocuments(result.project, deletedPaths);
    return result;
  }, [documents, setClosedTabs, setGroups]);

  const applyBatchMutation = useCallback(async (mutation: FractalMutationBatchResult) => {
    const reconciled = reconcileMutationBatch(documents.project, mutation);
    const { result, scope } = reconciled;
    if (mutation.receipts.some((receipt) => receipt.changes.length)) await reconcilePageDrafts(result.project.rootPath, scope.mappings);
    for (const path of Object.keys(documents.buffers)) {
      const nextPath = mapPagePath(path, scope.mappings);
      if (nextPath !== path) documents.renameDocument(path, nextPath);
    }
    setGroups((current) => reconcileWorkspacePaths(current, scope.mappings));
    setClosedTabs((current) => current.map((tab) => ({ ...tab, path: mapWorkspacePath(tab.path, scope.mappings) })));
    documents.publishProject(result.project);
    await documents.refreshChangedDocuments(result.project);
    return result;
  }, [documents, setClosedTabs, setGroups]);

  return { applyBatchMutation, applyMutation };
}

type WorkspacePaneProps = Omit<ComponentProps<typeof EditorGroupPane>, "buffer" | "focused" | "group" | "isLoading" | "onActivate" | "onCreateFirstPage">
  & Pick<ComponentProps<typeof WorkspaceTabs>, "onCloseTab" | "onDragEnd" | "onDragStart" | "onDropTab" | "onSelectTab" | "onSplitTab">;

type WorkspaceViewProps = {
  activeFolderPath: string | null;
  activeGroup: WorkspaceGroups["left"];
  anySaving: boolean;
  borealisOpen: boolean;
  borealisTabGroup: ReturnType<typeof groupForPath>;
  closeRightGroup: () => Promise<void>;
  closeWorkspaceProject: () => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  createPage: (title: string, folderPath?: string) => Promise<void>;
  deleteFolder: (path: string) => Promise<void>;
  deletePage: (path: string) => Promise<void>;
  documents: WorkspaceDocuments;
  draggedTab: DraggedWorkspaceTab | null;
  duplicatePage: (path: string) => Promise<void>;
  focusMode: boolean;
  groups: WorkspaceGroups;
  groupsRef: { current: WorkspaceGroups };
  movePage: (path: string, destinationFolder: string) => Promise<void>;
  moveWorkspaceTab: (tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => void;
  openFolderInGroup: (groupId: EditorGroupId, path: string) => void;
  openInGroup: (groupId: EditorGroupId, path: string, knownProject?: FractalProject) => Promise<void>;
  openSettings: () => Promise<void>;
  paneProps: WorkspacePaneProps;
  props: WorkspaceProps;
  quickOpen: boolean;
  setGroups: Dispatch<SetStateAction<WorkspaceGroups>>;
  setQuickOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarOpen: Dispatch<SetStateAction<boolean>>;
  setSidebarWidth: Dispatch<SetStateAction<number>>;
  setSplitPercent: Dispatch<SetStateAction<number>>;
  sidebarOpen: boolean;
  sidebarWidth: number;
  splitPercent: number;
  startSidebarResize: (event: PointerEvent<HTMLDivElement>) => void;
  startSplitResize: (event: PointerEvent<HTMLDivElement>) => void;
  validateProject: () => Promise<void>;
};

function WorkspaceSidebar({ view }: { view: WorkspaceViewProps }) {
  const { activeFolderPath, activeGroup, documents, props } = view;
  return (
    <Sidebar
      activePagePath={activeGroup.activePath === BOREALIS_TAB_ID || isFolderTab(activeGroup.activePath) ? null : activeGroup.activePath}
      activeFolderPath={activeFolderPath}
      folders={documents.project.folders}
      isBusy={props.isBusy}
      logoMark={props.settings.logoMark}
      pages={documents.project.pages}
      projectName={documents.project.name}
      onCloseProject={() => void view.closeWorkspaceProject()}
      onCreateFolder={(path) => { void view.createFolder(path); }}
      onCreatePage={(title, folder) => { void view.createPage(title, folder); }}
      onDeleteFolder={(path) => { void view.deleteFolder(path); }}
      onDeletePage={(path) => { void view.deletePage(path); }}
      onDuplicatePage={(path) => { void view.duplicatePage(path); }}
      onMovePage={(path, destination) => { void view.movePage(path, destination); }}
      onOpenSettings={() => void view.openSettings()}
      onResizeReset={() => view.setSidebarWidth(244)}
      onResizeStart={view.startSidebarResize}
      onRevealPage={props.onRevealPage}
      onSelectPage={(path) => { void view.openInGroup(view.groupsRef.current.activeGroupId, path); }}
      onSelectFolder={(path) => view.openFolderInGroup(view.groupsRef.current.activeGroupId, path)}
      onValidate={() => void view.validateProject()}
    />
  );
}

function WorkspaceTabStrips({ view }: { view: WorkspaceViewProps }) {
  const { documents, draggedTab, groups, paneProps } = view;
  return (
    <>
      <WorkspaceTabs
        buffers={documents.buffers}
        draggedTab={draggedTab}
        focused={groups.activeGroupId === "left"}
        group={groups.left}
        project={documents.project}
        onActivate={() => view.setGroups((current) => activateGroup(current, "left"))}
        onCloseTab={paneProps.onCloseTab}
        onDragEnd={paneProps.onDragEnd}
        onDragStart={paneProps.onDragStart}
        onDropTab={paneProps.onDropTab}
        onSelectTab={paneProps.onSelectTab}
        onSplitTab={paneProps.onSplitTab}
      />
      {groups.right ? (
        <WorkspaceTabs
          buffers={documents.buffers}
          draggedTab={draggedTab}
          focused={groups.activeGroupId === "right"}
          group={groups.right}
          project={documents.project}
          onActivate={() => view.setGroups((current) => activateGroup(current, "right"))}
          onCloseGroup={() => void view.closeRightGroup()}
          onCloseTab={paneProps.onCloseTab}
          onDragEnd={paneProps.onDragEnd}
          onDragStart={paneProps.onDragStart}
          onDropTab={paneProps.onDropTab}
          onSelectTab={paneProps.onSelectTab}
          onSplitTab={paneProps.onSplitTab}
        />
      ) : null}
    </>
  );
}

function WorkspaceHeader({ view }: { view: WorkspaceViewProps }) {
  const { activeGroup, anySaving, documents, props } = view;
  return (
    <WorkspaceToolbar
      activeGroupLabel={activeGroup.id}
      canGoBack={activeGroup.historyIndex > 0}
      canGoForward={activeGroup.historyIndex < activeGroup.history.length - 1}
      dirtyCount={documents.dirtyCount}
      isSaving={anySaving}
      onBack={() => view.setGroups((current) => navigateGroupHistory(current, current.activeGroupId, -1))}
      onCloseRequest={props.onCloseRequest}
      onForward={() => view.setGroups((current) => navigateGroupHistory(current, current.activeGroupId, 1))}
      onOpenQuick={() => view.setQuickOpen(true)}
      onToggleSidebar={() => view.setSidebarOpen((open) => !open)}
      tabs={<WorkspaceTabStrips view={view} />}
    />
  );
}

function WorkspaceStatus({ view }: { view: WorkspaceViewProps }) {
  const { documents, props } = view;
  return (
    <div className="workspace-status-stack" aria-live="polite">
      <CommandStatus error={props.error} result={props.commandResult} onDismiss={props.onDismissStatus} />
      {documents.pollingNotice ? (
        <button className="status-message error" onClick={documents.dismissPollingNotice} type="button">
          <span>Could not check files on disk</span>
          <small>{documents.pollingNotice.message}</small>
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceEditorGroup({ groupId, view }: { groupId: EditorGroupId; view: WorkspaceViewProps }) {
  const group = groupId === "left" ? view.groups.left : view.groups.right;
  if (!group) return null;
  return (
    <EditorGroupPane
      {...view.paneProps}
      buffer={group.activePath ? view.documents.buffers[group.activePath] : undefined}
      focused={view.groups.activeGroupId === groupId}
      group={group}
      isLoading={Boolean(group.activePath && view.documents.loadingPaths.has(group.activePath))}
      loadError={group.activePath ? view.documents.loadErrors[group.activePath] : undefined}
      onActivate={() => view.setGroups((current) => activateGroup(current, groupId))}
      onCreateFirstPage={groupId === "left" ? () => void view.createPage("Index") : undefined}
    />
  );
}

function WorkspaceEditorGroups({ view }: { view: WorkspaceViewProps }) {
  const { draggedTab, groups, splitPercent } = view;
  return (
    <div className={`${groups.right ? "editor-groups split" : "editor-groups"}${draggedTab ? " dragging-tab" : ""}`} style={{ "--split-primary": `${splitPercent}%` } as CSSProperties}>
      <WorkspaceEditorGroup groupId="left" view={view} />
      {groups.right ? (
        <>
          <div aria-label="Resize editor groups" className="split-resize-handle" onDoubleClick={() => view.setSplitPercent(50)} onPointerDown={view.startSplitResize} role="separator"><i /></div>
          <WorkspaceEditorGroup groupId="right" view={view} />
        </>
      ) : null}
      {draggedTab && !groups.right && !(draggedTab.path === BOREALIS_TAB_ID && groups.left.tabs.length === 1) ? (
        <div
          className="create-group-drop-zone"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            view.moveWorkspaceTab(draggedTab, "right");
          }}
        ><span>Drop to open right</span></div>
      ) : null}
    </div>
  );
}

function WorkspaceShell({ view }: { view: WorkspaceViewProps }) {
  return (
    <main className={`${view.focusMode ? "app-shell focus-mode" : "app-shell"}${view.sidebarOpen ? "" : " sidebar-closed"}`} style={{ "--sidebar-width": `${view.sidebarWidth}px` } as CSSProperties}>
      <WorkspaceSidebar view={view} />
      <section className="workspace" aria-label="Fractal workspace">
        <WorkspaceHeader view={view} />
        <WorkspaceStatus view={view} />
        <WorkspaceEditorGroups view={view} />
      </section>
      {view.quickOpen ? <QuickOpen documentQueries={view.documents.documentQueries} onClose={() => view.setQuickOpen(false)} onOpen={(path) => { void view.openInGroup(view.groups.activeGroupId, path); }} /> : null}
    </main>
  );
}

type WorkspaceClosedTab = { groupId: EditorGroupId; path: string };

type WorkspaceTabActionsOptions = {
  documents: WorkspaceDocuments;
  groupsRef: { current: WorkspaceGroups };
  setBorealisOpen: Dispatch<SetStateAction<boolean>>;
  setClosedTabs: Dispatch<SetStateAction<WorkspaceClosedTab[]>>;
  setDraggedTab: Dispatch<SetStateAction<DraggedWorkspaceTab | null>>;
  setGroups: Dispatch<SetStateAction<WorkspaceGroups>>;
};

function useWorkspaceTabActions({ documents, groupsRef, setBorealisOpen, setClosedTabs, setDraggedTab, setGroups }: WorkspaceTabActionsOptions) {
  const openInGroup = useCallback(async (groupId: EditorGroupId, path: string, knownProject?: FractalProject) => {
    setGroups((current) => openGroupTab(current, groupId, path));
    if (path !== BOREALIS_TAB_ID && !isFolderTab(path)) await documents.openDocument(path, knownProject);
  }, [documents.openDocument, setGroups]);

  const openFolderInGroup = useCallback((groupId: EditorGroupId, path: string) => {
    setGroups((current) => openGroupTab(current, groupId, folderTabId(path)));
  }, [setGroups]);

  const closeTab = useCallback(async (groupId: EditorGroupId, path: string) => {
    if (path === BOREALIS_TAB_ID) {
      setGroups((current) => closeGroupTab(current, groupId, path));
      setBorealisOpen(false);
      return;
    }
    if (isFolderTab(path)) {
      const folderPath = folderPathFromTabId(path);
      if (!(await documents.savePaths(folderPath == null ? [] : documents.pagePathsInFolder(folderPath)))) return;
      setClosedTabs((tabs) => [...tabs.filter((tab) => tab.path !== path || tab.groupId !== groupId), { groupId, path }]);
      setGroups((current) => closeGroupTab(current, groupId, path));
      return;
    }
    const buffer = documents.buffers[path];
    if (buffer?.dirty && !(await documents.saveDocument(path))) return;
    const next = closeGroupTab(groupsRef.current, groupId, path);
    setClosedTabs((tabs) => [...tabs.filter((tab) => tab.path !== path || tab.groupId !== groupId), { groupId, path }]);
    setGroups(next);
    const stillOpen = next.left.tabs.includes(path) || Boolean(next.right?.tabs.includes(path));
    if (!stillOpen) documents.forgetDocument(path);
  }, [documents.buffers, documents.forgetDocument, documents.pagePathsInFolder, documents.saveDocument, documents.savePaths, groupsRef, setBorealisOpen, setClosedTabs, setGroups]);

  const closeRightGroup = useCallback(async () => {
    const right = groupsRef.current.right;
    if (!right) return;
    const paths = right.tabs.flatMap((path) => {
      if (path === BOREALIS_TAB_ID) return [];
      if (isFolderTab(path)) {
        const folderPath = folderPathFromTabId(path);
        return folderPath == null ? [] : documents.pagePathsInFolder(folderPath);
      }
      return [path];
    });
    if (!(await documents.savePaths(paths))) return;
    let next = groupsRef.current;
    for (const path of right.tabs) next = closeGroupTab(next, "right", path);
    setGroups(next);
    for (const path of right.tabs) {
      if (path !== BOREALIS_TAB_ID && !next.left.tabs.includes(path)) documents.forgetDocument(path);
    }
  }, [documents.forgetDocument, documents.pagePathsInFolder, documents.savePaths, groupsRef, setGroups]);

  const toggleBorealis = useCallback(() => {
    const tabGroup = groupForPath(groupsRef.current, BOREALIS_TAB_ID);
    if (tabGroup) {
      setGroups((current) => openGroupTab(current, tabGroup, BOREALIS_TAB_ID));
      setBorealisOpen(false);
      return;
    }
    setBorealisOpen((open) => !open);
  }, [groupsRef, setBorealisOpen, setGroups]);

  const maximizeBorealis = useCallback(() => {
    setGroups((current) => openGroupTab(current, current.activeGroupId, BOREALIS_TAB_ID));
    setBorealisOpen(false);
  }, [setBorealisOpen, setGroups]);

  const moveWorkspaceTab = useCallback((tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => {
    setGroups((current) => {
      const source = tab.groupId === "left" ? current.left : current.right;
      if (tab.path === BOREALIS_TAB_ID && tab.groupId === "left" && groupId === "right" && source?.tabs.length === 1) return current;
      return moveGroupTab(current, tab.groupId, groupId, tab.path, index);
    });
    setDraggedTab(null);
  }, [setDraggedTab, setGroups]);

  const splitWorkspaceTab = useCallback((groupId: EditorGroupId, path: string) => {
    if (path !== BOREALIS_TAB_ID) {
      void openInGroup("right", path);
      return;
    }
    setGroups((current) => {
      const source = groupId === "left" ? current.left : current.right;
      if (!source || (groupId === "left" && source.tabs.length === 1)) return current;
      return moveGroupTab(current, groupId, "right", path);
    });
  }, [openInGroup, setGroups]);

  return { closeRightGroup, closeTab, maximizeBorealis, moveWorkspaceTab, openFolderInGroup, openInGroup, splitWorkspaceTab, toggleBorealis };
}

type WorkspaceProjectActionsOptions = {
  applyBatchMutation: (mutation: FractalMutationBatchResult) => Promise<FractalMutationBatchResult>;
  applyMutation: (mutation: FractalMutationResult) => Promise<FractalMutationResult>;
  documents: WorkspaceDocuments;
  groupsRef: { current: WorkspaceGroups };
  openInGroup: (groupId: EditorGroupId, path: string, knownProject?: FractalProject) => Promise<void>;
  props: WorkspaceProps;
  setGroups: Dispatch<SetStateAction<WorkspaceGroups>>;
};

function useWorkspacePageActions({ applyBatchMutation, applyMutation, documents, groupsRef, openInGroup, props }: WorkspaceProjectActionsOptions) {
  const createPage = useCallback(async (title: string, folderPath?: string) => {
    const result = await props.onCreatePage(title, folderPath);
    const accepted = result ? await applyMutation(result) : null;
    const next = accepted?.project;
    const created = accepted ? createdPagePath(accepted.receipt) : null;
    if (!next || !created) return;
    await openInGroup(groupsRef.current.activeGroupId, created, next);
  }, [applyMutation, groupsRef, openInGroup, props.onCreatePage]);

  const repairPage = useCallback(async (path: string) => {
    if (!(await documents.savePaths([path]))) return;
    const result = await props.onRepairPage(path);
    const accepted = result ? await applyMutation(result) : null;
    if (accepted) await documents.reloadDocument(path);
  }, [applyMutation, documents.reloadDocument, documents.savePaths, props.onRepairPage]);

  const duplicatePage = useCallback(async (path: string) => {
    if (!(await documents.savePaths([path]))) return;
    const result = await props.onDuplicatePage(path);
    const accepted = result ? await applyBatchMutation(result) : null;
    const next = accepted?.project;
    if (!next?.activePagePath) return;
    await openInGroup(groupsRef.current.activeGroupId, next.activePagePath, next);
  }, [applyBatchMutation, documents.savePaths, groupsRef, openInGroup, props.onDuplicatePage]);

  const createFolder = useCallback(async (path: string) => {
    const result = await props.onCreateFolder(path);
    if (result) await applyMutation(result);
  }, [applyMutation, props.onCreateFolder]);

  return { createFolder, createPage, duplicatePage, repairPage };
}

function useWorkspaceFolderActions({ applyMutation, documents, props, setGroups }: WorkspaceProjectActionsOptions) {
  const setFolderTitle = useCallback(async (path: string, title: string) => {
    if (!(await documents.saveAll())) return;
    const result = await props.onSetFolderTitle(path, title);
    if (result) await applyMutation(result);
  }, [applyMutation, documents.saveAll, props.onSetFolderTitle]);

  const reorderFolder = useCallback(async (path: string, order: string[]) => {
    const result = await props.onReorderFolder(path, order);
    if (result) await applyMutation(result);
  }, [applyMutation, props.onReorderFolder]);

  const deletePage = useCallback(async (path: string) => {
    if (!(await documents.savePaths([path]))) return;
    const result = await props.onDeletePage(path);
    const accepted = result ? await applyMutation(result) : null;
    const next = accepted?.project;
    if (!next) return;
    documents.forgetDocument(path);
    setGroups((current) => reconcileWorkspaceGroups(current, validWorkspaceTabs(next)));
  }, [applyMutation, documents.forgetDocument, documents.savePaths, props.onDeletePage, setGroups]);

  const deleteFolder = useCallback(async (path: string) => {
    if (!(await documents.savePaths(documents.pagePathsInFolder(path)))) return;
    const result = await props.onDeleteFolder(path);
    const accepted = result ? await applyMutation(result) : null;
    const next = accepted?.project;
    if (!next) return;
    const valid = validWorkspaceTabs(next);
    for (const bufferPath of Object.keys(documents.buffers)) {
      if (!valid.has(bufferPath)) documents.forgetDocument(bufferPath);
    }
    setGroups((current) => reconcileWorkspaceGroups(current, valid));
  }, [applyMutation, documents.buffers, documents.forgetDocument, documents.pagePathsInFolder, documents.savePaths, props.onDeleteFolder, setGroups]);

  const movePage = useCallback(async (path: string, destinationFolder: string) => {
    if (!(await documents.saveAll())) return;
    const result = await props.onMovePage(path, destinationFolder);
    if (result) await applyMutation(result);
  }, [applyMutation, documents.saveAll, props.onMovePage]);

  return { deleteFolder, deletePage, movePage, reorderFolder, setFolderTitle };
}

function useWorkspaceExportActions({ documents }: WorkspaceProjectActionsOptions) {
  const exportPage = useCallback(async (path: string, includeDerivedLinks: boolean) => {
    if (!(await documents.saveDocument(path))) return null;
    const savedPath = documents.resolveDocumentPath(path) ?? path;
    const page = documents.project.pages.find((candidate) => candidate.path === savedPath);
    const suggestedName = `${page?.title?.trim() || savedPath.split("/").at(-1)?.replace(/\.fractal\.html$/i, "") || "page"}.html`;
    const output = await save({ defaultPath: suggestedName, filters: [{ name: "HTML document", extensions: ["html"] }], title: "Export HTML" });
    if (!output) return null;
    return fractalClient.exportHtml(documents.project, savedPath, output, includeDerivedLinks);
  }, [documents.project, documents.resolveDocumentPath, documents.saveDocument]);

  const exportFolder = useCallback(async (path: string, options: FractalFolderHtmlExportOptions) => {
    const selectedPaths = options.selections.length ? options.selections : documents.pagePathsInFolder(path);
    if (!(await documents.savePaths(selectedPaths))) return null;
    const resolvedSelections = options.selections.map((selected) => documents.resolveDocumentPath(selected) ?? selected);
    const resolvedOptions = resolvedSelections.length ? { ...options, selections: resolvedSelections } : options;
    const folder = documents.project.folders.find((candidate) => candidate.path === path);
    const baseName = (folder?.title.trim() || path.split("/").at(-1) || documents.project.name || "folder")
      .replace(/[\\/:*?"<>|]+/g, "-");
    const output = await save({ defaultPath: `${baseName}.html`, filters: [{ name: "HTML document", extensions: ["html"] }], title: "Export folder as HTML" });
    if (!output) return null;
    return fractalClient.exportFolderHtml(documents.project, path, output, resolvedOptions);
  }, [documents.pagePathsInFolder, documents.project, documents.resolveDocumentPath, documents.savePaths]);

  return { exportFolder, exportPage };
}

function useWorkspaceUiState(initialRoot: string) {
  const [focusMode, setFocusMode] = useState(false);
  const [borealisOpen, setBorealisOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [quickOpen, setQuickOpen] = useState(false);
  const [groups, setGroups] = useState<WorkspaceGroups>(createProjectOverviewGroups);
  const [closedTabs, setClosedTabs] = useState<Array<{ groupId: EditorGroupId; path: string }>>([]);
  const [splitPercent, setSplitPercent] = useState(50);
  const [draggedTab, setDraggedTab] = useState<DraggedWorkspaceTab | null>(null);
  const previousRootRef = useRef(initialRoot);
  const groupsRef = useRef(groups);
  useEffect(() => {
    groupsRef.current = groups;
  }, [groups]);
  return {
    closedTabs,
    draggedTab,
    focusMode,
    groups,
    groupsRef,
    previousRootRef,
    quickOpen,
    setBorealisOpen,
    setClosedTabs,
    setDraggedTab,
    setFocusMode,
    setGroups,
    setQuickOpen,
    setSidebarOpen,
    setSidebarWidth,
    setSplitPercent,
    sidebarOpen,
    sidebarWidth,
    splitPercent,
    borealisOpen
  };
}

function useWorkspaceEffects(props: WorkspaceProps, ui: ReturnType<typeof useWorkspaceUiState>, documents: WorkspaceDocuments) {
  const { previousRootRef, setClosedTabs, setGroups } = ui;
  useEffect(() => {
    if (previousRootRef.current !== props.project.rootPath) {
      previousRootRef.current = props.project.rootPath;
      setGroups(createProjectOverviewGroups());
      setClosedTabs([]);
    }
  }, [props.project.rootPath, previousRootRef, setClosedTabs, setGroups]);

  useEffect(() => {
    const validPaths = new Set([...validWorkspaceTabs(documents.project), ...Object.keys(documents.buffers)]);
    setGroups((current) => reconcileWorkspaceGroups(current, validPaths));
    setClosedTabs((current) => current.filter((tab) => validPaths.has(tab.path)));
  }, [documents.buffers, documents.project.folders, documents.project.pages, setClosedTabs, setGroups]);

  useEffect(() => {
    props.onRegisterWorkspace(documents.dirtyCount > 0, documents.saveAll);
    return () => props.onRegisterWorkspace(false, null);
  }, [documents.dirtyCount, documents.saveAll, props.onRegisterWorkspace]);
}

function useWorkspaceActions(props: WorkspaceProps, ui: ReturnType<typeof useWorkspaceUiState>, documents: WorkspaceDocuments, activeGroup: WorkspaceGroups["left"]) {
  const tabActions = useWorkspaceTabActions({ documents, groupsRef: ui.groupsRef, setBorealisOpen: ui.setBorealisOpen, setClosedTabs: ui.setClosedTabs, setDraggedTab: ui.setDraggedTab, setGroups: ui.setGroups });
  const reconciliation = useWorkspaceMutationReconciliation(documents, ui.setClosedTabs, ui.setGroups);
  const projectActionOptions = { ...reconciliation, documents, groupsRef: ui.groupsRef, openInGroup: tabActions.openInGroup, props, setGroups: ui.setGroups };
  const pageActions = useWorkspacePageActions(projectActionOptions);
  const folderActions = useWorkspaceFolderActions(projectActionOptions);
  const exportActions = useWorkspaceExportActions(projectActionOptions);

  useWorkspaceShortcuts({
    activeGroup,
    closeTab: tabActions.closeTab,
    closedTabs: ui.closedTabs,
    createPage: pageActions.createPage,
    documents: { saveDocument: documents.saveDocument, saveFolder: documents.saveFolder },
    groupsRef: ui.groupsRef,
    openInGroup: tabActions.openInGroup,
    setClosedTabs: ui.setClosedTabs,
    setQuickOpen: ui.setQuickOpen,
    setSidebarOpen: ui.setSidebarOpen
  });

  return { exportActions, folderActions, pageActions, tabActions };
}

function Workspace(props: WorkspaceProps) {
  const ui = useWorkspaceUiState(props.project.rootPath);
  const { borealisOpen, closedTabs, draggedTab, focusMode, groups, groupsRef, quickOpen, setBorealisOpen, setClosedTabs, setDraggedTab, setFocusMode, setGroups, setQuickOpen, setSidebarOpen, setSidebarWidth, setSplitPercent, sidebarOpen, sidebarWidth, splitPercent } = ui;
  const onDocumentPathChange = useCallback((from: string, to: string) => {
    setGroups((current) => renameGroupTab(current, from, to));
  }, [setGroups]);
  const documents = useWorkspaceDocuments({
    autoSave: props.settings.autoSave,
    initialProject: props.project,
    onDocumentPathChange,
    onProjectSnapshot: props.onProjectSnapshot,
    onRequestConfirmation: props.onRequestConfirmation,
    projectGeneration: props.projectGeneration
  });

  const activeGroup = groups.activeGroupId === "right" && groups.right ? groups.right : groups.left;
  const activeFolderPath = activeGroup.activePath ? folderPathFromTabId(activeGroup.activePath) : null;
  const borealisTabGroup = groupForPath(groups, BOREALIS_TAB_ID);
  const borealisVisible = borealisOpen || borealisTabGroup !== null;
  const anySaving = Object.values(documents.buffers).some((buffer) => buffer.operation === "save");
  const aiWorkspace = useMemo(() => ({
    buffers: documents.buffers,
    documentQueries: documents.documentQueries,
    groups,
    project: documents.project,
  }), [documents.buffers, documents.documentQueries, documents.project, groups]);

  useWorkspaceEffects(props, ui, documents);
  const { exportActions, folderActions, pageActions, tabActions } = useWorkspaceActions(props, ui, documents, activeGroup);
  const { closeRightGroup, closeTab, maximizeBorealis, moveWorkspaceTab, openFolderInGroup, openInGroup, splitWorkspaceTab, toggleBorealis } = tabActions;
  const { createFolder, createPage, duplicatePage, repairPage } = pageActions;
  const { deleteFolder, deletePage, movePage, reorderFolder, setFolderTitle } = folderActions;
  const { exportFolder, exportPage } = exportActions;

  function startSplitResize(event: PointerEvent<HTMLDivElement>) {
    const stage = event.currentTarget.parentElement;
    if (!stage) return;
    startPointerResize(event, stage, (pointerEvent, bounds) => {
      const percentage = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.min(70, Math.max(30, percentage)));
    });
  }

  function startSidebarResize(event: PointerEvent<HTMLDivElement>) {
    const shell = event.currentTarget.closest<HTMLElement>(".app-shell");
    if (!shell) return;
    startPointerResize(event, shell, (pointerEvent, bounds) => {
      setSidebarWidth(Math.min(380, Math.max(190, pointerEvent.clientX - bounds.left)));
    });
  }

  async function closeWorkspaceProject() {
    if (!(await documents.saveAll())) return;
    props.onCloseProject();
  }

  async function openSettings() {
    props.onOpenSettings();
  }

  async function validateProject() {
    props.onValidate();
  }

  const paneProps = useMemo(() => ({
    borealisOpen: borealisVisible,
    borealisWorkspace: borealisTabGroup !== null,
    buffers: documents.buffers,
    documentQueries: documents.documentQueries,
    draggedTab,
    focusMode,
    project: documents.project,
    settings: props.settings,
    workspaceBusy: props.isBusy,
    onChangeSource: documents.updateSource,
    onModelChange: documents.updateModel,
    onRevision: documents.markRevision,
    onSnapshot: documents.updateSnapshot,
    onCreateFolder: (path: string) => { void createFolder(path); },
    onCreatePage: (title: string, folderPath?: string) => { void createPage(title, folderPath); },
    onCloseTab: (groupId: EditorGroupId, path: string) => { void closeTab(groupId, path); },
    onDragEnd: () => setDraggedTab(null),
    onDragStart: setDraggedTab,
    onDropTab: moveWorkspaceTab,
    onExport: exportPage,
    onExportFolder: exportFolder,
    onEnsurePage: documents.openDocument,
    loadingPaths: documents.loadingPaths,
    loadErrors: documents.loadErrors,
    onOpenFolder: openFolderInGroup,
    onNavigatePage: (groupId: EditorGroupId, path: string) => { void openInGroup(groupId, path); },
    onOpenSettings: () => { void openSettings(); },
    onReload: (path: string) => { void documents.reloadDocument(path); },
    onRecreate: (path: string) => { void documents.recreateDocument(path); },
    onReplace: (path: string) => { void documents.saveDocument(path, true); },
    onRepair: (path: string) => { void repairPage(path); },
    onRemoveMissing: (kind: "folder" | "native", path: string) => { if (kind === "folder") void deleteFolder(path); else void deletePage(path); },
    onReorderFolder: (path: string, order: string[]) => { void reorderFolder(path, order); },
    onSave: (path: string) => { void documents.saveDocument(path); },
    onSelectTab: (groupId: EditorGroupId, path: string) => { void openInGroup(groupId, path); },
    onSplitTab: splitWorkspaceTab,
    onSetFolderTitle: (path: string, title: string) => { void setFolderTitle(path, title); },
    onToggleFocus: () => setFocusMode((focus) => !focus),
    onToggleBorealis: toggleBorealis
  }), [borealisTabGroup, borealisVisible, closeTab, createFolder, createPage, deleteFolder, deletePage, documents.buffers, documents.documentQueries, documents.loadErrors, documents.loadingPaths, documents.openDocument, documents.project, documents.recreateDocument, documents.reloadDocument, documents.saveDocument, documents.updateModel, documents.updateSnapshot, documents.updateSource, draggedTab, exportFolder, exportPage, focusMode, moveWorkspaceTab, openFolderInGroup, openInGroup, props.isBusy, props.settings, repairPage, reorderFolder, setFolderTitle, splitWorkspaceTab, toggleBorealis]);

  const view: WorkspaceViewProps = {
    activeFolderPath,
    activeGroup,
    anySaving,
    borealisOpen,
    borealisTabGroup,
    closeRightGroup,
    closeWorkspaceProject,
    createFolder,
    createPage,
    deleteFolder,
    deletePage,
    documents,
    draggedTab,
    duplicatePage,
    focusMode,
    groups,
    groupsRef,
    movePage,
    moveWorkspaceTab,
    openFolderInGroup,
    openInGroup,
    openSettings,
    paneProps,
    props,
    quickOpen,
    setGroups,
    setQuickOpen,
    setSidebarOpen,
    setSidebarWidth,
    setSplitPercent,
    sidebarOpen,
    sidebarWidth,
    splitPercent,
    startSidebarResize,
    startSplitResize,
    validateProject
  };

  return (
    <BorealisSessionProvider settings={props.aiSettings} workspace={aiWorkspace}>
      <WorkspaceShell view={view} />
      {!borealisTabGroup ? <BorealisChat hidden={focusMode} isOpen={borealisOpen} onMaximize={maximizeBorealis} onOpenChange={setBorealisOpen} onOpenSettings={() => void openSettings()} showTrigger={false} /> : null}
    </BorealisSessionProvider>
  );
}

export default Workspace;
