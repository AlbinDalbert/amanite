import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent } from "react";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import { clearPageDraft, writePageDraft } from "@/app/pageDrafts";
import FractalEditor from "@/features/editor/components/FractalEditor";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalCommandResult, FractalProject, FractalSearchResult } from "@/lib/fractal/types";
import CommandStatus from "./CommandStatus";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";

type WorkspaceProps = {
  commandResult: FractalCommandResult | null;
  error: string | null;
  externalChangeDetected: boolean;
  isBusy: boolean;
  saveState: "saved" | "saving" | "unsaved";
  project: FractalProject;
  settings: AppearanceSettings;
  onChangePageSource: (source: string) => void;
  onCloseProject: () => void;
  onCloseRequest: () => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onCreateFolder: (folderPath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onDismissStatus: () => void;
  onDuplicatePage: (pagePath: string) => void;
  onInsertSuggestedLink: (text: string, target: string) => void;
  onImportNativePage: (source: string, folderPath?: string) => void;
  onMovePage: (pagePath: string, destination: string) => void;
  onOpenPage: (pagePath: string) => void;
  onOpenSettings: () => void;
  onReloadPage: () => void;
  onRegisterAuxiliaryPage: (dirty: boolean, save: (() => Promise<boolean>) | null) => void;
  onRevealPage: (pagePath?: string) => void;
  onSavePage: () => void;
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
    if (!query.trim()) { setResults(pages.map((page) => ({ path: page.path, title: page.title, snippet: page.text.slice(0, 140) }))); return; }
    const timeout = window.setTimeout(() => { void onSearch(query).then((found) => { if (!disposed) setResults(found); }); }, 120);
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
  const { project } = props;
  const activePage = project.pages.find((page) => page.path === project.activePagePath);
  const [focusMode, setFocusMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(244);
  const [quickOpen, setQuickOpen] = useState(false);
  const [openPaths, setOpenPaths] = useState<string[]>(() => project.activePagePath ? [project.activePagePath] : []);
  const [history, setHistory] = useState<string[]>(() => project.activePagePath ? [project.activePagePath] : []);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [closedPaths, setClosedPaths] = useState<string[]>([]);
  const [secondaryProject, setSecondaryProject] = useState<FractalProject | null>(null);
  const [secondaryDirty, setSecondaryDirty] = useState(false);
  const [secondaryOperation, setSecondaryOperation] = useState<"load" | "save" | null>(null);
  const [secondaryError, setSecondaryError] = useState<string | null>(null);
  const [splitPercent, setSplitPercent] = useState(50);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const previousRootRef = useRef(project.rootPath);
  const secondaryProjectRef = useRef(secondaryProject);
  const secondaryDirtyRef = useRef(secondaryDirty);
  const secondaryRevisionRef = useRef(0);
  const editorStageRef = useRef<HTMLDivElement>(null);
  secondaryProjectRef.current = secondaryProject;
  secondaryDirtyRef.current = secondaryDirty;

  const saveSecondary = useCallback(async () => {
    const snapshot = secondaryProjectRef.current;
    if (!snapshot?.activePagePath || snapshot.activePageSource == null || !secondaryDirtyRef.current) return true;
    const revision = secondaryRevisionRef.current;
    setSecondaryOperation("save");
    setSecondaryError(null);
    try {
      const saved = await fractalClient.writePage(snapshot, snapshot.activePageSource);
      const hasNewerEdits = secondaryRevisionRef.current !== revision;
      setSecondaryProject((current) => hasNewerEdits && current && current.activePagePath === saved.activePagePath
        ? { ...saved, activePageSource: current.activePageSource }
        : saved);
      setSecondaryDirty(hasNewerEdits);
      if (!hasNewerEdits && saved.activePagePath) clearPageDraft(saved.rootPath, saved.activePagePath);
      return true;
    } catch (error) {
      setSecondaryError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setSecondaryOperation(null);
    }
  }, []);

  const openSecondary = useCallback(async (pagePath: string) => {
    if (!pagePath || pagePath === project.activePagePath) return;
    if (!(await saveSecondary())) return;
    setSecondaryOperation("load");
    setSecondaryError(null);
    try {
      const loaded = await fractalClient.openPage(project, pagePath);
      secondaryRevisionRef.current = 0;
      setSecondaryProject(loaded);
      setSecondaryDirty(false);
      setOpenPaths((paths) => paths.includes(pagePath) ? paths : [...paths, pagePath]);
    } catch (error) {
      setSecondaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSecondaryOperation(null);
      setDraggingTab(null);
    }
  }, [project, saveSecondary]);

  const closeSecondary = useCallback(async () => {
    if (!(await saveSecondary())) return;
    setSecondaryProject(null);
    setSecondaryDirty(false);
    setSecondaryError(null);
  }, [saveSecondary]);

  const openPrimaryPage = useCallback(async (pagePath: string) => {
    if (secondaryProjectRef.current?.activePagePath === pagePath) {
      if (!(await saveSecondary())) return;
      setSecondaryProject(null);
      setSecondaryDirty(false);
    }
    props.onOpenPage(pagePath);
  }, [props.onOpenPage, saveSecondary]);

  useEffect(() => {
    if (previousRootRef.current !== project.rootPath) {
      previousRootRef.current = project.rootPath;
      const paths = project.activePagePath ? [project.activePagePath] : [];
      setOpenPaths(paths);
      setHistory(paths);
      setHistoryIndex(0);
      setSecondaryProject(null);
      setSecondaryDirty(false);
    }
  }, [project.activePagePath, project.rootPath]);
  useEffect(() => {
    const path = project.activePagePath;
    if (!path) return;
    setOpenPaths((paths) => paths.includes(path) ? paths : [...paths, path]);
    setHistory((items) => {
      if (items[historyIndex] === path) return items;
      const next = [...items.slice(0, historyIndex + 1), path];
      setHistoryIndex(next.length - 1);
      return next;
    });
  }, [project.activePagePath]);
  useEffect(() => {
    const snapshot = secondaryProject;
    if (!snapshot || !secondaryDirty) return;
    const draftTimeout = window.setTimeout(() => writePageDraft(snapshot), 180);
    const saveTimeout = props.settings.autoSave ? window.setTimeout(() => { void saveSecondary(); }, 900) : null;
    return () => { window.clearTimeout(draftTimeout); if (saveTimeout != null) window.clearTimeout(saveTimeout); };
  }, [props.settings.autoSave, saveSecondary, secondaryDirty, secondaryProject]);
  useEffect(() => {
    props.onRegisterAuxiliaryPage(secondaryDirty, secondaryProject ? saveSecondary : null);
    return () => props.onRegisterAuxiliaryPage(false, null);
  }, [props.onRegisterAuxiliaryPage, saveSecondary, secondaryDirty, secondaryProject]);
  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "p" || (key === "f" && event.shiftKey)) { event.preventDefault(); setQuickOpen(true); }
      else if (key === "b") { event.preventDefault(); setSidebarOpen((open) => !open); }
      else if (key === "n") { event.preventDefault(); props.onCreatePage("Untitled"); }
      else if (key === "w" && project.activePagePath) { event.preventDefault(); closeTab(project.activePagePath); }
      else if (key === "t" && event.shiftKey) {
        const path = closedPaths.at(-1);
        if (path) { event.preventDefault(); setClosedPaths((paths) => paths.slice(0, -1)); setOpenPaths((paths) => paths.includes(path) ? paths : [...paths, path]); void openPrimaryPage(path); }
      }
    }
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  const openPages = useMemo(() => openPaths.map((path) => project.pages.find((page) => page.path === path)).filter((page): page is NonNullable<typeof page> => Boolean(page)), [openPaths, project.pages]);
  const secondaryPage = secondaryProject?.pages.find((page) => page.path === secondaryProject.activePagePath);

  function closeTab(path: string) {
    setClosedPaths((paths) => [...paths.filter((candidate) => candidate !== path), path]);
    if (path === secondaryProjectRef.current?.activePagePath) void closeSecondary();
    setOpenPaths((paths) => {
      const index = paths.indexOf(path);
      const next = paths.filter((candidate) => candidate !== path);
      if (path === project.activePagePath) {
        const target = next.find((candidate) => candidate !== secondaryProjectRef.current?.activePagePath);
        if (target) void openPrimaryPage(target);
        else if (secondaryProjectRef.current?.activePagePath) void openPrimaryPage(secondaryProjectRef.current.activePagePath);
      }
      return next;
    });
  }

  function goHistory(direction: -1 | 1) {
    const next = historyIndex + direction;
    const path = history[next];
    if (!path) return;
    setHistoryIndex(next);
    void openPrimaryPage(path);
  }

  function updateSecondarySource(source: string) {
    secondaryRevisionRef.current += 1;
    setSecondaryProject((snapshot) => snapshot ? { ...snapshot, activePageSource: source } : snapshot);
    setSecondaryDirty(true);
  }

  async function insertSecondaryLink(text: string, target: string) {
    if (!(await saveSecondary())) return;
    const snapshot = secondaryProjectRef.current;
    if (!snapshot) return;
    setSecondaryOperation("save");
    try {
      const linked = await fractalClient.insertLink(snapshot, text, target);
      setSecondaryProject(linked);
      setSecondaryDirty(false);
    } catch (error) {
      setSecondaryError(error instanceof Error ? error.message : String(error));
    } finally {
      setSecondaryOperation(null);
    }
  }

  function handleTabDrop(event: DragEvent<HTMLDivElement>) {
    const pagePath = event.dataTransfer.getData("application/x-amanite-tab") || draggingTab;
    if (!pagePath) return;
    event.preventDefault();
    void openSecondary(pagePath);
  }

  function startSplitResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const stage = editorStageRef.current;
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
    if (!(await saveSecondary())) return;
    props.onCloseProject();
  }

  return (
    <main className={`${focusMode ? "app-shell focus-mode" : "app-shell"}${sidebarOpen ? "" : " sidebar-closed"}`} style={{ "--sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
      <Sidebar
        activePagePath={project.activePagePath ?? null}
        isBusy={props.isBusy}
        pages={project.pages}
        folders={project.folders}
        projectName={project.name}
        onCreatePage={props.onCreatePage}
        onCloseProject={() => void closeWorkspaceProject()}
        onCreateFolder={props.onCreateFolder}
        onDeletePage={props.onDeletePage}
        onDeleteFolder={props.onDeleteFolder}
        onDuplicatePage={props.onDuplicatePage}
        onImportNativePage={props.onImportNativePage}
        onMovePage={props.onMovePage}
        onOpenSettings={props.onOpenSettings}
        onResizeReset={() => setSidebarWidth(244)}
        onResizeStart={startSidebarResize}
        onRevealPage={props.onRevealPage}
        onSelectPage={(path) => void openPrimaryPage(path)}
        onValidate={props.onValidate}
      />
      <section className="workspace" aria-label="Fractal workspace">
        <WorkspaceToolbar
          activePagePath={project.activePagePath}
          activePageTitle={activePage?.title}
          activePageKind={activePage?.kind}
          canGoBack={historyIndex > 0}
          canGoForward={historyIndex < history.length - 1}
          externalChangeDetected={props.externalChangeDetected}
          isBusy={props.isBusy || secondaryOperation !== null}
          openPages={openPages}
          saveState={props.saveState === "saving" || secondaryOperation === "save" ? "saving" : props.saveState === "unsaved" || secondaryDirty ? "unsaved" : "saved"}
          secondaryPagePath={secondaryProject?.activePagePath}
          onBack={() => goHistory(-1)}
          onCloseRequest={props.onCloseRequest}
          onCloseTab={closeTab}
          onForward={() => goHistory(1)}
          onOpenQuick={() => setQuickOpen(true)}
          onReload={props.onReloadPage}
          onSave={() => { props.onSavePage(); void saveSecondary(); }}
          onSelectTab={(path) => path === secondaryProject?.activePagePath
            ? editorStageRef.current?.querySelector<HTMLElement>(".editor-pane.secondary .rich-content-editable, .editor-pane.secondary textarea")?.focus()
            : void openPrimaryPage(path)}
          onSplitTab={(path) => void openSecondary(path)}
          onTabDragEnd={() => setDraggingTab(null)}
          onTabDragStart={setDraggingTab}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
        />
        <CommandStatus error={props.error} result={props.commandResult} onDismiss={props.onDismissStatus} />
        <div
          className={`${secondaryProject ? "editor-stage split" : "editor-stage"}${draggingTab ? " tab-dragging" : ""}`}
          onDragOver={(event) => { if (event.dataTransfer.types.includes("application/x-amanite-tab")) event.preventDefault(); }}
          onDrop={handleTabDrop}
          ref={editorStageRef}
          style={{ "--split-primary": `${splitPercent}%` } as CSSProperties}
        >
          <section className="editor-pane primary" aria-label="Primary editor pane">
            {secondaryProject ? <span className="pane-marker">Left</span> : null}
            {project.activePagePath && project.activePageSource != null ? (
              <FractalEditor
                backlinks={project.activePageBacklinks}
                derivedLinks={project.activePageDerivedLinks}
                focusMode={focusMode}
                isBusy={props.isBusy}
                iframeBacklinks={project.activePageIframeBacklinks}
                iframes={project.activePageIframes}
                kind={activePage?.kind ?? "raw"}
                linkSuggestions={project.activePageLinkSuggestions}
                links={project.activePageLinks}
                pages={project.pages}
                pagePath={project.activePagePath}
                source={project.activePageSource}
                spellCheck={props.settings.spellCheck}
                wordGoal={props.settings.wordGoal}
                onChangeSource={props.onChangePageSource}
                onInsertSuggestedLink={props.onInsertSuggestedLink}
                onNavigatePage={(path) => void openPrimaryPage(path)}
                onSave={props.onSavePage}
                onToggleFocus={() => setFocusMode((focus) => !focus)}
              />
            ) : (
              <section className="empty-project"><p>Empty project</p><h2>Create the first HTML page.</h2><button className="primary-action" disabled={props.isBusy} onClick={() => props.onCreatePage("Index")} type="button">Create page</button></section>
            )}
          </section>
          {secondaryProject ? (
            <>
              <div aria-label="Resize editor panes" className="split-resize-handle" onDoubleClick={() => setSplitPercent(50)} onPointerDown={startSplitResize} role="separator"><i /></div>
              <section className="editor-pane secondary" aria-label="Secondary editor pane">
                <div className="secondary-pane-controls">
                  <span>Right</span>
                  <small className={secondaryDirty ? "unsaved" : ""}>{secondaryOperation === "save" ? "Saving" : secondaryDirty ? "Unsaved" : "Saved"}</small>
                  <button aria-label="Close right editor pane" onClick={() => void closeSecondary()} type="button">×</button>
                </div>
                {secondaryProject.activePagePath && secondaryProject.activePageSource != null ? (
                  <FractalEditor
                    backlinks={secondaryProject.activePageBacklinks}
                    derivedLinks={secondaryProject.activePageDerivedLinks}
                    focusMode={focusMode}
                    isBusy={secondaryOperation !== null}
                    iframeBacklinks={secondaryProject.activePageIframeBacklinks}
                    iframes={secondaryProject.activePageIframes}
                    kind={secondaryPage?.kind ?? "raw"}
                    linkSuggestions={secondaryProject.activePageLinkSuggestions}
                    links={secondaryProject.activePageLinks}
                    pages={secondaryProject.pages}
                    pagePath={secondaryProject.activePagePath}
                    source={secondaryProject.activePageSource}
                    spellCheck={props.settings.spellCheck}
                    wordGoal={props.settings.wordGoal}
                    onChangeSource={updateSecondarySource}
                    onInsertSuggestedLink={(text, target) => void insertSecondaryLink(text, target)}
                    onNavigatePage={(path) => void openSecondary(path)}
                    onSave={() => void saveSecondary()}
                    onToggleFocus={() => setFocusMode((focus) => !focus)}
                  />
                ) : null}
                {secondaryError ? <p className="secondary-pane-error">{secondaryError}</p> : null}
              </section>
            </>
          ) : null}
          {draggingTab && draggingTab !== project.activePagePath ? <div className="split-drop-target"><strong>Open beside</strong><span>Drop the tab to create a right editor pane</span></div> : null}
        </div>
      </section>
      {quickOpen ? <QuickOpen pages={project.pages} onClose={() => setQuickOpen(false)} onOpen={(path) => void openPrimaryPage(path)} onSearch={props.onSearchProject} /> : null}
    </main>
  );
}

export default Workspace;
