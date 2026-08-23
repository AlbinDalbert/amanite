import FractalEditor from "@/features/editor/components/FractalEditor";
import type { FractalCommandResult, FractalProject } from "@/lib/fractal/types";
import CommandStatus from "./CommandStatus";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";

type WorkspaceProps = {
  commandResult: FractalCommandResult | null;
  error: string | null;
  hasUnsavedPageChanges: boolean;
  isBusy: boolean;
  saveState: "saved" | "saving" | "unsaved";
  project: FractalProject;
  onChangePageSource: (source: string) => void;
  onCloseRequest: () => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onCreateFolder: (folderPath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onDismissStatus: () => void;
  onMovePage: (pagePath: string, destination: string) => void;
  onOpenPage: (pagePath: string) => void;
  onOpenSettings: () => void;
  onSavePage: () => void;
  onValidate: () => void;
};

function Workspace(props: WorkspaceProps) {
  const { project } = props;
  const activePage = project.pages.find((page) => page.path === project.activePagePath);

  return (
    <main className="app-shell">
      <Sidebar
        activePagePath={project.activePagePath ?? null}
        isBusy={props.isBusy}
        pages={project.pages}
        folders={project.folders}
        projectName={project.name}
        onCreatePage={props.onCreatePage}
        onCreateFolder={props.onCreateFolder}
        onDeletePage={props.onDeletePage}
        onDeleteFolder={props.onDeleteFolder}
        onMovePage={props.onMovePage}
        onOpenSettings={props.onOpenSettings}
        onSelectPage={props.onOpenPage}
        onValidate={props.onValidate}
      />
      <section className="workspace" aria-label="Fractal workspace">
        <WorkspaceToolbar
          activePagePath={project.activePagePath}
          activePageTitle={activePage?.title}
          activePageKind={activePage?.kind}
          isBusy={props.isBusy}
          onCloseRequest={props.onCloseRequest}
          saveState={props.saveState}
          onSave={props.onSavePage}
        />
        <CommandStatus error={props.error} result={props.commandResult} onDismiss={props.onDismissStatus} />
        <div className="editor-stage">
          {project.activePagePath && project.activePageSource != null ? (
            <FractalEditor
              backlinks={project.activePageBacklinks}
              isBusy={props.isBusy}
              iframeBacklinks={project.activePageIframeBacklinks}
              iframes={project.activePageIframes}
              kind={activePage?.kind ?? "raw"}
              links={project.activePageLinks}
              pagePath={project.activePagePath}
              source={project.activePageSource}
              onChangeSource={props.onChangePageSource}
              onNavigatePage={props.onOpenPage}
              onSave={props.onSavePage}
            />
          ) : (
            <section className="empty-project">
              <p>Empty project</p>
              <h2>Create the first HTML page.</h2>
              <button className="primary-action" disabled={props.isBusy} onClick={() => props.onCreatePage("Index")} type="button">
                Create page
              </button>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}

export default Workspace;
