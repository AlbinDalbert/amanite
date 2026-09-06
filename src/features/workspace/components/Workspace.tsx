import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { AiSettings } from "@/app/useAiSettings";
import BorealisChat, { BorealisSessionProvider } from "@/features/ai-chat/components/AiChat";
import type { FractalCommandResult, FractalFolderHtmlExportOptions, FractalProject, FractalSearchResult } from "@/lib/fractal/types";
import { fractalClient } from "@/lib/fractal/client";
import { useWorkspaceDocuments } from "../useWorkspaceDocuments";
import { folderPathFromTabId, folderTabId, isFolderTab } from "../folderTabs";
import {
  activateGroup,
  BOREALIS_TAB_ID,
  closeGroupTab,
  createProjectOverviewGroups,
  groupForPath,
  moveGroupTab,
  navigateGroupHistory,
  openGroupTab,
  reconcileWorkspaceGroups,
  renameGroupTab,
  tabPathForDirection,
  tabPathForShortcut,
  type EditorGroupId,
  type WorkspaceGroups
} from "../workspaceGroups";
import CommandStatus from "./CommandStatus";
import EditorGroupPane from "./EditorGroupPane";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";
import WorkspaceTabs, { type DraggedWorkspaceTab } from "./WorkspaceTabs";

type ProjectMutation = Promise<FractalProject | null | undefined>;

function validWorkspaceTabs(project: FractalProject) {
  return new Set([...project.pages.map((page) => page.path), ...project.folders.map((folder) => folderTabId(folder.path)), BOREALIS_TAB_ID]);
}

type WorkspaceProps = {
  aiSettings: AiSettings;
  commandResult: FractalCommandResult | null;
  error: string | null;
  isBusy: boolean;
  project: FractalProject;
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
  onDuplicatePage: (pagePath: string) => ProjectMutation;
  onRepairPage: (pagePath: string) => ProjectMutation;
  onMovePage: (pagePath: string, destination: string) => ProjectMutation;
  onOpenSettings: () => void;
  onProjectSnapshot: (project: FractalProject) => void;
  onRegisterWorkspace: (dirty: boolean, save: (() => Promise<boolean>) | null) => void;
  onRequestConfirmation: (message: string, confirmLabel?: string) => Promise<boolean>;
  onRevealPage: (pagePath?: string) => void;
  onSearchProject: (query: string) => Promise<FractalSearchResult[]>;
  onValidate: () => void;
};

function QuickOpen({ pages, onClose, onOpen, onSearch }: {
  pages: FractalProject["pages"];
  onClose: () => void;
  onOpen: (path: string) => void;
  onSearch: (query: string) => Promise<FractalSearchResult[]>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<FractalSearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    let disposed = false;
    if (!query.trim()) {
      setResults(pages.map((page) => ({ path: page.path, title: page.title, snippet: page.text.slice(0, 140) })));
      return;
    }
    const timeout = window.setTimeout(() => {
      void onSearch(query).then((found) => { if (!disposed) setResults(found); });
    }, 120);
    return () => { disposed = true; window.clearTimeout(timeout); };
  }, [onSearch, pages, query]);

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

function Workspace(props: WorkspaceProps) {
  const [focusMode, setFocusMode] = useState(false);
  const [borealisOpen, setBorealisOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [quickOpen, setQuickOpen] = useState(false);
  const [groups, setGroups] = useState<WorkspaceGroups>(createProjectOverviewGroups);
  const [closedTabs, setClosedTabs] = useState<Array<{ groupId: EditorGroupId; path: string }>>([]);
  const [splitPercent, setSplitPercent] = useState(50);
  const [draggedTab, setDraggedTab] = useState<DraggedWorkspaceTab | null>(null);
  const previousRootRef = useRef(props.project.rootPath);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  const onDocumentPathChange = useCallback((from: string, to: string) => {
    setGroups((current) => renameGroupTab(current, from, to));
  }, []);

  const documents = useWorkspaceDocuments({
    autoSave: props.settings.autoSave,
    initialProject: props.project,
    onDocumentPathChange,
    onProjectSnapshot: props.onProjectSnapshot,
    onRequestConfirmation: props.onRequestConfirmation
  });

  const activeGroup = groups.activeGroupId === "right" && groups.right ? groups.right : groups.left;
  const activeFolderPath = activeGroup.activePath ? folderPathFromTabId(activeGroup.activePath) : null;
  const borealisTabGroup = groupForPath(groups, BOREALIS_TAB_ID);
  const borealisVisible = borealisOpen || borealisTabGroup !== null;
  const anySaving = Object.values(documents.buffers).some((buffer) => buffer.operation === "save");
  const aiWorkspace = useMemo(() => ({
    buffers: documents.buffers,
    groups,
    project: documents.project,
    searchProject: (query: string) => fractalClient.searchProject(documents.project, query)
  }), [documents.buffers, documents.project, groups]);

  useEffect(() => {
    if (previousRootRef.current !== props.project.rootPath) {
      previousRootRef.current = props.project.rootPath;
      setGroups(createProjectOverviewGroups());
      setClosedTabs([]);
    }
  }, [props.project.rootPath]);

  useEffect(() => {
    const validPaths = validWorkspaceTabs(documents.project);
    setGroups((current) => reconcileWorkspaceGroups(current, validPaths));
    for (const path of Object.keys(documents.buffers)) {
      if (!validPaths.has(path)) documents.forgetDocument(path);
    }
  }, [documents.project.folders, documents.project.pages]);

  useEffect(() => {
    props.onRegisterWorkspace(documents.dirtyCount > 0, documents.saveAll);
    return () => props.onRegisterWorkspace(false, null);
  }, [documents.dirtyCount, documents.saveAll, props.onRegisterWorkspace]);

  const openInGroup = useCallback(async (groupId: EditorGroupId, path: string, knownProject?: FractalProject) => {
    setGroups((current) => openGroupTab(current, groupId, path));
    if (path !== BOREALIS_TAB_ID && !isFolderTab(path)) await documents.openDocument(path, knownProject);
  }, [documents.openDocument]);

  const openFolderInGroup = useCallback((groupId: EditorGroupId, path: string) => {
    setGroups((current) => openGroupTab(current, groupId, folderTabId(path)));
  }, []);

  const closeTab = useCallback(async (groupId: EditorGroupId, path: string) => {
    if (path === BOREALIS_TAB_ID) {
      setGroups((current) => closeGroupTab(current, groupId, path));
      setBorealisOpen(false);
      return;
    }
    if (isFolderTab(path)) {
      if (!(await documents.saveAll())) return;
      setClosedTabs((tabs) => [...tabs.filter((tab) => tab.path !== path || tab.groupId !== groupId), { groupId, path }]);
      setGroups((current) => closeGroupTab(current, groupId, path));
      return;
    }
    const buffer = documents.buffers[path];
    if (buffer?.dirty && !(await documents.saveDocument(path))) return;
    const current = groupsRef.current;
    const next = closeGroupTab(current, groupId, path);
    setClosedTabs((tabs) => [...tabs.filter((tab) => tab.path !== path || tab.groupId !== groupId), { groupId, path }]);
    setGroups(next);
    const stillOpen = next.left.tabs.includes(path) || Boolean(next.right?.tabs.includes(path));
    if (!stillOpen) documents.forgetDocument(path);
  }, [documents.buffers, documents.forgetDocument, documents.saveAll, documents.saveDocument]);

  const closeRightGroup = useCallback(async () => {
    const right = groupsRef.current.right;
    if (!right) return;
    if (!(await documents.saveAll())) return;
    for (const path of right.tabs) {
      const buffer = documents.buffers[path];
      if (buffer?.dirty && !(await documents.saveDocument(path))) return;
    }
    let next = groupsRef.current;
    for (const path of right.tabs) next = closeGroupTab(next, "right", path);
    setGroups(next);
    for (const path of right.tabs) {
      if (path !== BOREALIS_TAB_ID && !next.left.tabs.includes(path)) documents.forgetDocument(path);
    }
  }, [documents.buffers, documents.forgetDocument, documents.saveAll, documents.saveDocument]);

  const createPage = useCallback(async (title: string, folderPath?: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onCreatePage(title, folderPath);
    if (!next?.activePagePath) return;
    documents.publishProject(next);
    await openInGroup(groupsRef.current.activeGroupId, next.activePagePath, next);
  }, [documents.publishProject, documents.saveAll, openInGroup, props.onCreatePage]);

  const repairPage = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onRepairPage(path);
    if (!next) return;
    documents.publishProject(next);
    await documents.reloadDocument(path);
  }, [documents.publishProject, documents.reloadDocument, documents.saveAll, props.onRepairPage]);

  const duplicatePage = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onDuplicatePage(path);
    if (!next?.activePagePath) return;
    documents.publishProject(next);
    await openInGroup(groupsRef.current.activeGroupId, next.activePagePath, next);
  }, [documents.publishProject, documents.saveAll, openInGroup, props.onDuplicatePage]);

  const createFolder = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onCreateFolder(path);
    if (next) documents.publishProject(next);
  }, [documents.publishProject, documents.saveAll, props.onCreateFolder]);

  const setFolderTitle = useCallback(async (path: string, title: string) => {
    if (!(await documents.saveAll())) return;
    const previousProject = documents.project;
    const next = await props.onSetFolderTitle(path, title);
    if (!next) return;
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    const renamedFolder = path
      ? next.folders.find((folder) => {
        const folderParent = folder.path.includes("/") ? folder.path.slice(0, folder.path.lastIndexOf("/")) : "";
        return folder.path !== path && folderParent === parentPath && folder.title === title.trim();
      })
      : undefined;
    if (renamedFolder) {
      setGroups((current) => renameGroupTab(current, folderTabId(path), folderTabId(renamedFolder.path)));
      for (const folder of previousProject.folders.filter((candidate) => candidate.path.startsWith(`${path}/`))) {
        const suffix = folder.path.slice(path.length + 1);
        const nextPath = `${renamedFolder.path}/${suffix}`;
        if (next.folders.some((candidate) => candidate.path === nextPath)) {
          setGroups((current) => renameGroupTab(current, folderTabId(folder.path), folderTabId(nextPath)));
        }
      }
      for (const page of previousProject.pages.filter((candidate) => candidate.path.startsWith(`${path}/`))) {
        const suffix = page.path.slice(path.length + 1);
        const nextPath = next.pages.find((candidate) => candidate.path === `${renamedFolder.path}/${suffix}`)?.path;
        if (nextPath) {
          documents.renameDocument(page.path, nextPath);
          setGroups((current) => renameGroupTab(current, page.path, nextPath));
        }
      }
    }
    documents.publishProject(next);
  }, [documents.project, documents.publishProject, documents.renameDocument, documents.saveAll, props.onSetFolderTitle]);

  const reorderFolder = useCallback(async (path: string, order: string[]) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onReorderFolder(path, order);
    if (next) documents.publishProject(next);
  }, [documents.publishProject, documents.saveAll, props.onReorderFolder]);

  const deletePage = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onDeletePage(path);
    if (!next) return;
    documents.publishProject(next);
    documents.forgetDocument(path);
    setGroups((current) => reconcileWorkspaceGroups(current, validWorkspaceTabs(next)));
  }, [documents.forgetDocument, documents.publishProject, documents.saveAll, props.onDeletePage]);

  const deleteFolder = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onDeleteFolder(path);
    if (!next) return;
    documents.publishProject(next);
    const valid = validWorkspaceTabs(next);
    for (const bufferPath of Object.keys(documents.buffers)) {
      if (!valid.has(bufferPath)) documents.forgetDocument(bufferPath);
    }
    setGroups((current) => reconcileWorkspaceGroups(current, valid));
  }, [documents.buffers, documents.forgetDocument, documents.publishProject, documents.saveAll, props.onDeleteFolder]);

  const movePage = useCallback(async (path: string, destination: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onMovePage(path, destination);
    if (!next) return;
    documents.publishProject(next);
    setGroups((current) => renameGroupTab(current, path, destination));
    documents.renameDocument(path, destination);
    await documents.reloadDocument(destination);
    await documents.refreshChangedDocuments(next, [destination]);
  }, [documents.publishProject, documents.refreshChangedDocuments, documents.reloadDocument, documents.renameDocument, documents.saveAll, props.onMovePage]);

  const exportPage = useCallback(async (path: string, includeDerivedLinks: boolean) => {
    if (!(await documents.saveDocument(path))) return null;
    const page = documents.project.pages.find((candidate) => candidate.path === path);
    const suggestedName = `${page?.title?.trim() || path.split("/").at(-1)?.replace(/\.fractal\.html$/i, "") || "page"}.html`;
    const output = await save({ defaultPath: suggestedName, filters: [{ name: "HTML document", extensions: ["html"] }], title: "Export HTML" });
    if (!output) return null;
    return fractalClient.exportHtml(documents.project, path, output, includeDerivedLinks);
  }, [documents.project, documents.saveDocument]);

  const exportFolder = useCallback(async (path: string, options: FractalFolderHtmlExportOptions) => {
    if (!(await documents.saveAll())) return null;
    const folder = documents.project.folders.find((candidate) => candidate.path === path);
    const baseName = (folder?.title.trim() || path.split("/").at(-1) || documents.project.name || "folder")
      .replace(/[\\/:*?"<>|]+/g, "-");
    const output = await save({ defaultPath: `${baseName}.html`, filters: [{ name: "HTML document", extensions: ["html"] }], title: "Export folder as HTML" });
    if (!output) return null;
    return fractalClient.exportFolderHtml(documents.project, path, output, options);
  }, [documents.project, documents.saveAll]);

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      const cyclingTab = key === "tab" && !event.altKey
        ? tabPathForDirection(activeGroup, event.shiftKey ? -1 : 1)
        : null;
      const numberedTab = !event.altKey && !event.shiftKey ? tabPathForShortcut(activeGroup, key) : null;
      if (cyclingTab) {
        event.preventDefault();
        void openInGroup(activeGroup.id, cyclingTab);
      } else if (numberedTab) {
        event.preventDefault();
        void openInGroup(activeGroup.id, numberedTab);
      } else if (key === "s") {
        if (event.defaultPrevented) return;
        event.preventDefault();
        if (activeGroup.activePath && isFolderTab(activeGroup.activePath)) void documents.saveAll();
        else if (activeGroup.activePath && activeGroup.activePath !== BOREALIS_TAB_ID) void documents.saveDocument(activeGroup.activePath);
      } else if (key === "p" || (key === "f" && event.shiftKey)) {
        event.preventDefault();
        setQuickOpen(true);
      } else if (key === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (key === "n") {
        event.preventDefault();
        void createPage("Untitled");
      } else if (key === "w" && activeGroup.activePath) {
        event.preventDefault();
        void closeTab(activeGroup.id, activeGroup.activePath);
      } else if (key === "t" && event.shiftKey) {
        const tab = closedTabs.at(-1);
        if (!tab) return;
        event.preventDefault();
        setClosedTabs((tabs) => tabs.slice(0, -1));
        void openInGroup(tab.groupId === "right" && !groupsRef.current.right ? "left" : tab.groupId, tab.path);
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [activeGroup.activePath, activeGroup.id, activeGroup.tabs, closedTabs, closeTab, createPage, documents.saveDocument, openInGroup]);

  function startSplitResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const stage = event.currentTarget.parentElement;
    if (!stage) return;
    const move = (pointerEvent: globalThis.PointerEvent) => {
      const bounds = stage.getBoundingClientRect();
      const percentage = ((pointerEvent.clientX - bounds.left) / bounds.width) * 100;
      setSplitPercent(Math.min(70, Math.max(30, percentage)));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("resizing-panel"); };
    document.body.classList.add("resizing-panel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  function startSidebarResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const shell = event.currentTarget.closest(".app-shell");
    if (!shell) return;
    const move = (pointerEvent: globalThis.PointerEvent) => {
      const bounds = shell.getBoundingClientRect();
      setSidebarWidth(Math.min(380, Math.max(190, pointerEvent.clientX - bounds.left)));
    };
    const stop = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", stop); document.body.classList.remove("resizing-panel"); };
    document.body.classList.add("resizing-panel");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop, { once: true });
  }

  async function closeWorkspaceProject() {
    if (!(await documents.saveAll())) return;
    props.onCloseProject();
  }

  async function openSettings() {
    if (!(await documents.saveAll())) return;
    props.onOpenSettings();
  }

  async function validateProject() {
    if (!(await documents.saveAll())) return;
    props.onValidate();
  }

  const toggleBorealis = useCallback(() => {
    const tabGroup = groupForPath(groupsRef.current, BOREALIS_TAB_ID);
    if (tabGroup) {
      setGroups((current) => openGroupTab(current, tabGroup, BOREALIS_TAB_ID));
      setBorealisOpen(false);
      return;
    }
    setBorealisOpen((open) => !open);
  }, []);

  const maximizeBorealis = useCallback(() => {
    setGroups((current) => openGroupTab(current, current.activeGroupId, BOREALIS_TAB_ID));
    setBorealisOpen(false);
  }, []);

  const moveWorkspaceTab = useCallback((tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => {
    setGroups((current) => {
      const source = tab.groupId === "left" ? current.left : current.right;
      if (tab.path === BOREALIS_TAB_ID && tab.groupId === "left" && groupId === "right" && source?.tabs.length === 1) return current;
      return moveGroupTab(current, tab.groupId, groupId, tab.path, index);
    });
    setDraggedTab(null);
  }, []);

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
  }, [openInGroup]);

  const paneProps = useMemo(() => ({
    aiSettings: props.aiSettings,
    borealisOpen: borealisVisible,
    borealisWorkspace: borealisTabGroup !== null,
    buffers: documents.buffers,
    draggedTab,
    focusMode,
    project: documents.project,
    settings: props.settings,
    workspaceBusy: props.isBusy,
    onChangeSource: documents.updateSource,
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
  }), [borealisTabGroup, borealisVisible, closeTab, createFolder, createPage, deleteFolder, deletePage, documents.buffers, documents.loadErrors, documents.loadingPaths, documents.openDocument, documents.project, documents.reloadDocument, documents.saveDocument, documents.updateSource, draggedTab, exportFolder, exportPage, focusMode, moveWorkspaceTab, openFolderInGroup, openInGroup, props.aiSettings, props.isBusy, props.settings, repairPage, reorderFolder, setFolderTitle, splitWorkspaceTab, toggleBorealis]);

  return (
    <BorealisSessionProvider settings={props.aiSettings} workspace={aiWorkspace}>
      <main className={`${focusMode ? "app-shell focus-mode" : "app-shell"}${sidebarOpen ? "" : " sidebar-closed"}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        activePagePath={activeGroup.activePath === BOREALIS_TAB_ID || isFolderTab(activeGroup.activePath) ? null : activeGroup.activePath}
        activeFolderPath={activeFolderPath}
        folders={documents.project.folders}
        isBusy={props.isBusy}
        logoMark={props.settings.logoMark}
        pages={documents.project.pages}
        projectName={documents.project.name}
        onCloseProject={() => void closeWorkspaceProject()}
        onCreateFolder={(path) => { void createFolder(path); }}
        onCreatePage={(title, folder) => { void createPage(title, folder); }}
        onDeleteFolder={(path) => { void deleteFolder(path); }}
        onDeletePage={(path) => { void deletePage(path); }}
        onDuplicatePage={(path) => { void duplicatePage(path); }}
        onMovePage={(path, destination) => { void movePage(path, destination); }}
        onOpenSettings={() => void openSettings()}
        onResizeReset={() => setSidebarWidth(244)}
        onResizeStart={startSidebarResize}
        onRevealPage={props.onRevealPage}
        onSelectPage={(path) => { void openInGroup(groupsRef.current.activeGroupId, path); }}
        onSelectFolder={(path) => openFolderInGroup(groupsRef.current.activeGroupId, path)}
        onValidate={() => void validateProject()}
      />
      <section className="workspace" aria-label="Fractal workspace">
        <WorkspaceToolbar
          activeGroupLabel={activeGroup.id}
          canGoBack={activeGroup.historyIndex > 0}
          canGoForward={activeGroup.historyIndex < activeGroup.history.length - 1}
          dirtyCount={documents.dirtyCount}
          isSaving={anySaving}
          onBack={() => setGroups((current) => navigateGroupHistory(current, current.activeGroupId, -1))}
          onCloseRequest={props.onCloseRequest}
          onForward={() => setGroups((current) => navigateGroupHistory(current, current.activeGroupId, 1))}
          onOpenQuick={() => setQuickOpen(true)}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          tabs={(
            <>
              <WorkspaceTabs
                buffers={documents.buffers}
                draggedTab={draggedTab}
                focused={groups.activeGroupId === "left"}
                group={groups.left}
                project={documents.project}
                onActivate={() => setGroups((current) => activateGroup(current, "left"))}
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
                  onActivate={() => setGroups((current) => activateGroup(current, "right"))}
                  onCloseGroup={() => void closeRightGroup()}
                  onCloseTab={paneProps.onCloseTab}
                  onDragEnd={paneProps.onDragEnd}
                  onDragStart={paneProps.onDragStart}
                  onDropTab={paneProps.onDropTab}
                  onSelectTab={paneProps.onSelectTab}
                  onSplitTab={paneProps.onSplitTab}
                />
              ) : null}
            </>
          )}
        />
        <div className="workspace-status-stack" aria-live="polite">
          <CommandStatus error={props.error} result={props.commandResult} onDismiss={props.onDismissStatus} />
          {documents.pollingNotice ? (
            <button className="status-message error" onClick={documents.dismissPollingNotice} type="button">
              <span>Could not check files on disk</span>
              <small>{documents.pollingNotice.message}</small>
            </button>
          ) : null}
        </div>
        <div className={`${groups.right ? "editor-groups split" : "editor-groups"}${draggedTab ? " dragging-tab" : ""}`} style={{ "--split-primary": `${splitPercent}%` } as CSSProperties}>
          <EditorGroupPane
            {...paneProps}
            buffer={groups.left.activePath ? documents.buffers[groups.left.activePath] : undefined}
            focused={groups.activeGroupId === "left"}
            group={groups.left}
            isLoading={Boolean(groups.left.activePath && documents.loadingPaths.has(groups.left.activePath))}
            loadError={groups.left.activePath ? documents.loadErrors[groups.left.activePath] : undefined}
            onActivate={() => setGroups((current) => activateGroup(current, "left"))}
            onCreateFirstPage={() => void createPage("Index")}
          />
          {groups.right ? (
            <>
              <div aria-label="Resize editor groups" className="split-resize-handle" onDoubleClick={() => setSplitPercent(50)} onPointerDown={startSplitResize} role="separator"><i /></div>
              <EditorGroupPane
                {...paneProps}
                buffer={groups.right.activePath ? documents.buffers[groups.right.activePath] : undefined}
                focused={groups.activeGroupId === "right"}
                group={groups.right}
                isLoading={Boolean(groups.right.activePath && documents.loadingPaths.has(groups.right.activePath))}
                loadError={groups.right.activePath ? documents.loadErrors[groups.right.activePath] : undefined}
                onActivate={() => setGroups((current) => activateGroup(current, "right"))}
                onCloseGroup={() => void closeRightGroup()}
              />
            </>
          ) : null}
          {draggedTab && !groups.right && !(draggedTab.path === BOREALIS_TAB_ID && groups.left.tabs.length === 1) ? (
            <div
              className="create-group-drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                moveWorkspaceTab(draggedTab, "right");
              }}
            ><span>Drop to open right</span></div>
          ) : null}
        </div>
      </section>
      {quickOpen ? <QuickOpen pages={documents.project.pages} onClose={() => setQuickOpen(false)} onOpen={(path) => { void openInGroup(groupsRef.current.activeGroupId, path); }} onSearch={props.onSearchProject} /> : null}
      </main>
      {!borealisTabGroup ? <BorealisChat hidden={focusMode} isOpen={borealisOpen} onMaximize={maximizeBorealis} onOpenChange={setBorealisOpen} onOpenSettings={() => void openSettings()} showTrigger={false} /> : null}
    </BorealisSessionProvider>
  );
}

export default Workspace;
