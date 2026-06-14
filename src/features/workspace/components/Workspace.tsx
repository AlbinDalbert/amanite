import type { CSSProperties } from "react";
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
  project: FractalProject;
  onBuildIndex: () => void;
  onChangePageBodyHtml: (bodyHtml: string) => void;
  onChangePageTitle: (title: string) => void;
  onCreatePage: (pagePath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onOpenPage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSavePage: () => void;
  onValidate: () => void;
};

function Workspace({
  commandResult,
  error,
  hasUnsavedPageChanges,
  isBusy,
  project,
  onBuildIndex,
  onChangePageBodyHtml,
  onChangePageTitle,
  onCreatePage,
  onDeletePage,
  onOpenPage,
  onRenamePage,
  onSavePage,
  onValidate
}: WorkspaceProps) {
  return (
    <main className="app-shell">
      <Sidebar
        activePagePath={project.activePagePath}
        canDeletePage={project.pages.length > 1}
        isBusy={isBusy}
        pages={project.pages}
        projectName={project.name}
        onBuildIndex={onBuildIndex}
        onCreatePage={onCreatePage}
        onDeletePage={onDeletePage}
        onRenamePage={onRenamePage}
        onSelectPage={onOpenPage}
        onValidate={onValidate}
      />
      <section
        className="workspace"
        style={project.theme as CSSProperties | undefined}
        aria-label="Fractal workspace"
      >
        <WorkspaceToolbar projectName={project.name} />
        <CommandStatus error={error} result={commandResult} />
        <div className="editor-stage" aria-label="Editable Fractal page">
          <FractalEditor
            isBusy={isBusy}
            isDirty={hasUnsavedPageChanges}
            bodyHtml={project.activePageBodyHtml}
            backlinks={project.activePageBacklinks}
            links={project.activePageLinks}
            notes={project.activePageNotes}
            outlinks={project.activePageOutlinks}
            pagePath={project.activePagePath}
            summary={project.activePageSummary}
            tags={project.activePageTags}
            title={project.activePageTitle}
            onChangeBodyHtml={onChangePageBodyHtml}
            onChangeTitle={onChangePageTitle}
            onSave={onSavePage}
          />
        </div>
      </section>
    </main>
  );
}

export default Workspace;
