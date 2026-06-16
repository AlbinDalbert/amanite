import type { CSSProperties } from "react";
import FractalEditor from "@/features/editor/components/FractalEditor";
import type { FractalCommandResult, FractalNote, FractalProject } from "@/lib/fractal/types";
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
  onChangePageSummary: (summary: string) => void;
  onChangePageTags: (tags: string[]) => void;
  onChangePageTitle: (title: string) => void;
  onCreatePage: (pagePath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onAddNote: (trigger: string, content: string) => void;
  onDeleteNote: (note: FractalNote) => void;
  onDismissStatus: () => void;
  onOpenPage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSavePage: () => void;
  onUpdateNote: (note: FractalNote, content: string) => void;
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
  onChangePageSummary,
  onChangePageTags,
  onChangePageTitle,
  onCreatePage,
  onDeletePage,
  onAddNote,
  onDeleteNote,
  onDismissStatus,
  onOpenPage,
  onRenamePage,
  onSavePage,
  onUpdateNote,
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
        <CommandStatus error={error} result={commandResult} onDismiss={onDismissStatus} />
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
            onAddNote={onAddNote}
            onDeleteNote={onDeleteNote}
            onChangeSummary={onChangePageSummary}
            onChangeTags={onChangePageTags}
            onChangeTitle={onChangePageTitle}
            onNavigatePage={onOpenPage}
            onSave={onSavePage}
            onUpdateNote={onUpdateNote}
          />
        </div>
      </section>
    </main>
  );
}

export default Workspace;
