import { Component, type ErrorInfo, type ReactNode } from "react";
import BorealisChat from "@/features/ai-chat/components/AiChat";
import FractalEditor from "@/features/editor/components/FractalEditor";
import type { PageTitleIndex } from "@/lib/fractal/pageTitleIndex";
import type { AppearanceSettings } from "@/app/useAppearanceSettings";
import type { FractalFolder, FractalProject } from "@/lib/fractal/types";
import type { FractalFolderHtmlExportOptions, FractalFolderHtmlExportReport, FractalHtmlExportReport } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import type { DocumentQueryIndex } from "../documentQueryIndex";
import { folderPathFromTabId } from "../folderTabs";
import { BOREALIS_TAB_ID, type EditorGroupId } from "../workspaceGroups";
import type { WorkspaceDocumentCallbacks } from "../workspaceCallbacks";
import type { DocumentRegistry } from "../documents/documentRuntime";
import { useDocumentSession } from "../documents/useDocumentSession";
import FolderView from "./FolderView";

export type EditorGroupTabPanelContext = WorkspaceDocumentCallbacks & {
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  buffers: Record<string, DocumentBuffer>;
  documentQueries: DocumentQueryIndex;
  documentRegistry: DocumentRegistry;
  isPageOpen: (path: string) => boolean;
  focusMode: boolean;
  focused: boolean;
  isLoading: boolean;
  loadingPaths: Set<string>;
  loadErrors: Record<string, string>;
  onExport: (path: string, includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport | null>;
  onExportFolder: (path: string, options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport | null>;
  onNavigatePage: (groupId: EditorGroupId, path: string) => void;
  onOpenFolder: (groupId: EditorGroupId, path: string) => void;
  onOpenSettings: () => void;
  onRemoveMissing: (kind: "folder" | "native", path: string) => void;
  onRepair: (path: string) => void;
  onReorderFolder: (path: string, order: string[]) => void;
  onSave: (path: string) => void;
  onSetFolderTitle: (path: string, title: string) => void;
  onToggleBorealis: () => void;
  onToggleFocus: () => void;
  pages: FractalProject["pages"];
  pageTitleIndex?: PageTitleIndex;
  project: FractalProject;
  settings: AppearanceSettings;
  workspaceBusy: boolean;
};

type Props = {
  active: boolean;
  context: EditorGroupTabPanelContext;
  groupId: EditorGroupId;
  path: string;
};

type DocumentOpenErrorBoundaryProps = {
  children: ReactNode;
  path: string;
};

type DocumentOpenErrorBoundaryState = {
  error: Error | null;
};

class DocumentOpenErrorBoundary extends Component<DocumentOpenErrorBoundaryProps, DocumentOpenErrorBoundaryState> {
  state: DocumentOpenErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): DocumentOpenErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Amanite could not render document ${this.props.path}.`, error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <section className="document-open-error" role="alert">
          <span>Document failed to open</span>
          <h2>{this.props.path}</h2>
          <p>{this.state.error.message || "Amanite encountered an unexpected editor error."}</p>
          <small>The rest of the workspace is still available. Close and reopen this document after addressing the error.</small>
        </section>
      );
    }

    return this.props.children;
  }
}

function BorealisTabPanel({ active, onOpenSettings }: Pick<EditorGroupTabPanelContext, "onOpenSettings"> & Pick<Props, "active">) {
  return (
    <div className={active ? "editor-tab-panel active borealis-tab-panel" : "editor-tab-panel borealis-tab-panel"} hidden={!active} role="tabpanel">
      <BorealisChat onOpenSettings={onOpenSettings} presentation="workspace" showTrigger={false} />
    </div>
  );
}

type FolderTabPanelProps = Pick<Props, "active" | "groupId"> & {
  context: EditorGroupTabPanelContext;
  folder: FractalFolder;
  folderPath: string;
};

function FolderTabPanel({ active, context, folder, folderPath, groupId }: FolderTabPanelProps) {
  return (
    <div className={active ? "editor-tab-panel active" : "editor-tab-panel"} hidden={!active} role="tabpanel">
      <FolderView
        borealisOpen={context.borealisOpen}
        borealisWorkspace={context.borealisWorkspace}
        buffers={context.buffers}
        documentRegistry={context.documentRegistry}
        documentQueries={context.documentQueries}
        folder={folder}
        editorOwner={active && context.focused}
        focusMode={context.focusMode}
        folders={context.project.folders}
        isBusy={context.workspaceBusy}
        loadingPaths={context.loadingPaths}
        loadErrors={context.loadErrors}
        pages={context.pages}
        pageTitleIndex={context.pageTitleIndex}
        isPageOpen={context.isPageOpen}
        projectName={context.project.name}
        spellCheck={context.settings.spellCheck}
        onChangeSource={context.onChangeSource}
        onModelChange={context.onModelChange}
        onCreateFolder={context.onCreateFolder}
        onCreatePage={context.onCreatePage}
        onEnsurePage={context.onEnsurePage}
        onExport={(options) => context.onExportFolder(folderPath, options)}
        onOpenFolder={(nextPath) => context.onOpenFolder(groupId, nextPath)}
        onOpenPage={(nextPath) => context.onNavigatePage(groupId, nextPath)}
        onRemoveMissing={context.onRemoveMissing}
        onReorder={(order) => context.onReorderFolder(folderPath, order)}
        onSavePage={context.onSave}
        onSetTitle={(title) => context.onSetFolderTitle(folderPath, title)}
        onToggleBorealis={context.onToggleBorealis}
        onToggleFocus={context.onToggleFocus}
      />
    </div>
  );
}

type DocumentTabPanelProps = Pick<Props, "active" | "groupId"> & {
  context: EditorGroupTabPanelContext;
  path: string;
};

function DocumentTabPanel({ active, context, groupId, path }: DocumentTabPanelProps) {
  const tabBuffer = context.buffers[path];
  const tabPage = context.pages.find((candidate) => candidate.path === path);
  if (!tabBuffer || !tabPage) return null;
  return (
    <DocumentOpenErrorBoundary key={path} path={path}>
      <LoadedDocumentTabPanel active={active} context={context} groupId={groupId} path={path} tabBuffer={tabBuffer} tabPage={tabPage} />
    </DocumentOpenErrorBoundary>
  );
}

function LoadedDocumentTabPanel({ active, context, groupId, path, tabBuffer, tabPage }: DocumentTabPanelProps & { tabBuffer: DocumentBuffer; tabPage: FractalProject["pages"][number] }) {
  const session = useDocumentSession(context.documentRegistry, tabBuffer.path, {
    bodyHtml: tabBuffer.bodyHtml,
    initialReplacementGeneration: tabBuffer.incarnation,
    initialRevision: tabBuffer.revision,
    title: tabBuffer.title
  });
  const editable = active && context.focused;
  return (
    <div className={active ? "editor-tab-panel active" : "editor-tab-panel"} hidden={!active} role="tabpanel">
      <FractalEditor
        borealisOpen={context.borealisOpen}
        borealisWorkspace={context.borealisWorkspace}
        backlinks={tabBuffer.backlinks}
        bodyHtml={tabBuffer.bodyHtml}
        documentId={tabBuffer.documentId}
        sourceIncarnation={tabBuffer.incarnation}
        editable={editable}
        focusMode={context.focusMode}
        isBusy={context.workspaceBusy || (active && context.isLoading)}
        isFractalValid={Boolean(tabBuffer.nativeDocumentParts)}
        links={tabBuffer.links}
        pageTitleIndex={context.pageTitleIndex}
        pages={context.pages}
        pagePath={path}
        projectName={context.project.name}
        documentSession={session}
        source={tabBuffer.source}
        spellCheck={context.settings.spellCheck}
        title={tabBuffer.title}
        viewId={`${groupId}:${tabBuffer.documentId}`}
        wordGoal={context.settings.wordGoal}
        onChangeSource={(source, nativeSection) => context.onChangeSource(path, source, nativeSection)}
        onModelChange={(snapshot) => context.onModelChange?.(path, snapshot)}
        onRevision={editable ? (revision) => context.onRevision?.(path, revision) : () => undefined}
        onSnapshot={(snapshot) => context.onSnapshot?.(path, snapshot)}
        onExport={(includeDerivedLinks) => context.onExport(path, includeDerivedLinks)}
        onNavigatePage={(nextPath) => context.onNavigatePage(groupId, nextPath)}
        onOpenFolder={(folderPath) => context.onOpenFolder(groupId, folderPath)}
        onRepair={() => context.onRepair(path)}
        onSave={() => context.onSave(path)}
        onToggleFocus={context.onToggleFocus}
        onToggleBorealis={context.onToggleBorealis}
      />
    </div>
  );
}

export function EditorGroupTabPanel({ active, context, groupId, path }: Props) {
  if (path === BOREALIS_TAB_ID) return <BorealisTabPanel active={active} onOpenSettings={context.onOpenSettings} />;

  const folderPath = folderPathFromTabId(path);
  if (folderPath != null) {
    const folder = context.project.folders.find((candidate) => candidate.path === folderPath);
    if (!folder) return null;
    return <FolderTabPanel active={active} context={context} folder={folder} folderPath={folderPath} groupId={groupId} />;
  }

  return <DocumentTabPanel active={active} context={context} groupId={groupId} path={path} />;
}
