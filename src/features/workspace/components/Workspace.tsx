import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from "react";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { FractalCommandResult, FractalProject, FractalSearchResult } from "@/lib/fractal/types";
import { useWorkspaceDocuments } from "../useWorkspaceDocuments";
import {
  activateGroup,
  closeGroupTab,
  createWorkspaceGroups,
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
import EditorGroupPane, { type DraggedWorkspaceTab } from "./EditorGroupPane";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";

type ProjectMutation = Promise<FractalProject | null | undefined>;

type WorkspaceProps = {
  commandResult: FractalCommandResult | null;
  error: string | null;
  isBusy: boolean;
  project: FractalProject;
  settings: AppearanceSettings;
  onCloseProject: () => void;
  onCloseRequest: () => void;
  onCreatePage: (title: string, folderPath?: string) => ProjectMutation;
  onCreateFolder: (folderPath: string) => ProjectMutation;
  onDeletePage: (pagePath: string) => ProjectMutation;
  onDeleteFolder: (folderPath: string) => ProjectMutation;
  onDismissStatus: () => void;
  onDuplicatePage: (pagePath: string) => ProjectMutation;
  onImportNativePage: (source: string, folderPath?: string) => ProjectMutation;
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [quickOpen, setQuickOpen] = useState(false);
  const [groups, setGroups] = useState<WorkspaceGroups>(() => createWorkspaceGroups(props.project.activePagePath));
  const [closedTabs, setClosedTabs] = useState<Array<{ groupId: EditorGroupId; path: string }>>([]);
  const [splitPercent, setSplitPercent] = useState(50);
  const [draggedTab, setDraggedTab] = useState<DraggedWorkspaceTab | null>(null);
  const previousRootRef = useRef(props.project.rootPath);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const documents = useWorkspaceDocuments({
    autoSave: props.settings.autoSave,
    initialProject: props.project,
    onProjectSnapshot: props.onProjectSnapshot,
    onRequestConfirmation: props.onRequestConfirmation
  });

  const activeGroup = groups.activeGroupId === "right" && groups.right ? groups.right : groups.left;
  const anySaving = Object.values(documents.buffers).some((buffer) => buffer.operation === "save");
  const anyLoading = documents.loadingPaths.size > 0;

  useEffect(() => {
    if (previousRootRef.current !== props.project.rootPath) {
      previousRootRef.current = props.project.rootPath;
      setGroups(createWorkspaceGroups(props.project.activePagePath));
      setClosedTabs([]);
    }
  }, [props.project.activePagePath, props.project.rootPath]);

  useEffect(() => {
    const validPaths = new Set(documents.project.pages.map((page) => page.path));
    setGroups((current) => reconcileWorkspaceGroups(current, validPaths));
    for (const path of Object.keys(documents.buffers)) {
      if (!validPaths.has(path)) documents.forgetDocument(path);
    }
  }, [documents.project.pages]);

  useEffect(() => {
    props.onRegisterWorkspace(documents.dirtyCount > 0, documents.saveAll);
    return () => props.onRegisterWorkspace(false, null);
  }, [documents.dirtyCount, documents.saveAll, props.onRegisterWorkspace]);

  const openInGroup = useCallback(async (groupId: EditorGroupId, path: string, knownProject?: FractalProject) => {
    setGroups((current) => openGroupTab(current, groupId, path));
    await documents.openDocument(path, knownProject);
  }, [documents.openDocument]);

  const closeTab = useCallback(async (groupId: EditorGroupId, path: string) => {
    const buffer = documents.buffers[path];
    if (buffer?.dirty && !(await documents.saveDocument(path))) return;
    const current = groupsRef.current;
    const next = closeGroupTab(current, groupId, path);
    setClosedTabs((tabs) => [...tabs.filter((tab) => tab.path !== path || tab.groupId !== groupId), { groupId, path }]);
    setGroups(next);
    const stillOpen = next.left.tabs.includes(path) || Boolean(next.right?.tabs.includes(path));
    if (!stillOpen) documents.forgetDocument(path);
  }, [documents.buffers, documents.forgetDocument, documents.saveDocument]);

  const closeRightGroup = useCallback(async () => {
    const right = groupsRef.current.right;
    if (!right) return;
    for (const path of right.tabs) {
      const buffer = documents.buffers[path];
      if (buffer?.dirty && !(await documents.saveDocument(path))) return;
    }
    let next = groupsRef.current;
    for (const path of right.tabs) next = closeGroupTab(next, "right", path);
    setGroups(next);
    for (const path of right.tabs) {
      if (!next.left.tabs.includes(path)) documents.forgetDocument(path);
    }
  }, [documents.buffers, documents.forgetDocument, documents.saveDocument]);

  const createPage = useCallback(async (title: string, folderPath?: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onCreatePage(title, folderPath);
    if (!next?.activePagePath) return;
    documents.publishProject(next);
    await openInGroup(groupsRef.current.activeGroupId, next.activePagePath, next);
  }, [documents.publishProject, documents.saveAll, openInGroup, props.onCreatePage]);

  const importPage = useCallback(async (source: string, folderPath?: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onImportNativePage(source, folderPath);
    if (!next?.activePagePath) return;
    documents.publishProject(next);
    await openInGroup(groupsRef.current.activeGroupId, next.activePagePath, next);
  }, [documents.publishProject, documents.saveAll, openInGroup, props.onImportNativePage]);

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

  const deletePage = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onDeletePage(path);
    if (!next) return;
    documents.publishProject(next);
    documents.forgetDocument(path);
    setGroups((current) => reconcileWorkspaceGroups(current, new Set(next.pages.map((page) => page.path))));
  }, [documents.forgetDocument, documents.publishProject, documents.saveAll, props.onDeletePage]);

  const deleteFolder = useCallback(async (path: string) => {
    if (!(await documents.saveAll())) return;
    const next = await props.onDeleteFolder(path);
    if (!next) return;
    documents.publishProject(next);
    const valid = new Set(next.pages.map((page) => page.path));
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
        if (activeGroup.activePath) void documents.saveDocument(activeGroup.activePath);
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

  const paneProps = useMemo(() => ({
    buffers: documents.buffers,
    draggedTab,
    focusMode,
    project: documents.project,
    settings: props.settings,
    workspaceBusy: props.isBusy,
    onChangeSource: documents.updateSource,
    onCloseTab: (groupId: EditorGroupId, path: string) => { void closeTab(groupId, path); },
    onDragEnd: () => setDraggedTab(null),
    onDragStart: setDraggedTab,
    onDropTab: (tab: DraggedWorkspaceTab, groupId: EditorGroupId, index?: number) => {
      setGroups((current) => moveGroupTab(current, tab.groupId, groupId, tab.path, index));
      setDraggedTab(null);
    },
    onNavigatePage: (groupId: EditorGroupId, path: string) => { void openInGroup(groupId, path); },
    onReload: (path: string) => { void documents.reloadDocument(path); },
    onReplace: (path: string) => { void documents.saveDocument(path, true); },
    onSave: (path: string) => { void documents.saveDocument(path); },
    onSelectTab: (groupId: EditorGroupId, path: string) => { void openInGroup(groupId, path); },
    onSplitTab: (_groupId: EditorGroupId, path: string) => { void openInGroup("right", path); },
    onToggleFocus: () => setFocusMode((focus) => !focus)
  }), [closeTab, documents.buffers, documents.project, documents.reloadDocument, documents.saveDocument, documents.updateSource, draggedTab, focusMode, openInGroup, props.isBusy, props.settings]);

  return (
    <main className={`${focusMode ? "app-shell focus-mode" : "app-shell"}${sidebarOpen ? "" : " sidebar-closed"}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        activePagePath={activeGroup.activePath}
        folders={documents.project.folders}
        isBusy={props.isBusy || anyLoading}
        logoMark={props.settings.logoMark}
        pages={documents.project.pages}
        projectName={documents.project.name}
        onCloseProject={() => void closeWorkspaceProject()}
        onCreateFolder={(path) => { void createFolder(path); }}
        onCreatePage={(title, folder) => { void createPage(title, folder); }}
        onDeleteFolder={(path) => { void deleteFolder(path); }}
        onDeletePage={(path) => { void deletePage(path); }}
        onDuplicatePage={(path) => { void duplicatePage(path); }}
        onImportNativePage={(source, folder) => { void importPage(source, folder); }}
        onMovePage={(path, destination) => { void movePage(path, destination); }}
        onOpenSettings={() => void openSettings()}
        onResizeReset={() => setSidebarWidth(244)}
        onResizeStart={startSidebarResize}
        onRevealPage={props.onRevealPage}
        onSelectPage={(path) => { void openInGroup(groupsRef.current.activeGroupId, path); }}
        onValidate={() => void validateProject()}
      />
      <section className="workspace" aria-label="Fractal workspace">
        <WorkspaceToolbar
          activeGroupLabel={activeGroup.id}
          canGoBack={activeGroup.historyIndex > 0}
          canGoForward={activeGroup.historyIndex < activeGroup.history.length - 1}
          dirtyCount={documents.dirtyCount}
          isBusy={props.isBusy || anyLoading}
          isSaving={anySaving}
          onBack={() => setGroups((current) => navigateGroupHistory(current, current.activeGroupId, -1))}
          onCloseRequest={props.onCloseRequest}
          onForward={() => setGroups((current) => navigateGroupHistory(current, current.activeGroupId, 1))}
          onOpenQuick={() => setQuickOpen(true)}
          onSave={() => {
            if (documents.dirtyCount > 1) void documents.saveAll();
            else {
              const dirty = Object.values(documents.buffers).find((buffer) => buffer.dirty);
              if (dirty) void documents.saveDocument(dirty.path);
            }
          }}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
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
          {draggedTab && !groups.right ? (
            <div
              className="create-group-drop-zone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setGroups((current) => moveGroupTab(current, draggedTab.groupId, "right", draggedTab.path));
                setDraggedTab(null);
              }}
            ><span>Drop to open right</span></div>
          ) : null}
        </div>
      </section>
      {quickOpen ? <QuickOpen pages={documents.project.pages} onClose={() => setQuickOpen(false)} onOpen={(path) => { void openInGroup(groupsRef.current.activeGroupId, path); }} onSearch={props.onSearchProject} /> : null}
    </main>
  );
}

export default Workspace;
