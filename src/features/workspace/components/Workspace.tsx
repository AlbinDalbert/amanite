import type { CSSProperties } from "react";
import FractalEditor from "@/features/editor/components/FractalEditor";
import type { FractalCommandResult, FractalProject } from "@/lib/fractal/types";
import CommandStatus from "./CommandStatus";
import Sidebar from "./Sidebar";
import WorkspaceToolbar from "./WorkspaceToolbar";

type WorkspaceProps = {
  commandResult: FractalCommandResult | null;
  error: string | null;
  isBusy: boolean;
  project: FractalProject;
  onBuildIndex: () => void;
  onValidate: () => void;
};

function Workspace({
  commandResult,
  error,
  isBusy,
  project,
  onBuildIndex,
  onValidate
}: WorkspaceProps) {
  return (
    <main className="app-shell">
      <Sidebar
        activePagePath={project.activePagePath}
        pages={project.pages}
        projectName={project.name}
      />
      <section
        className="workspace"
        style={project.theme as CSSProperties | undefined}
        aria-label="Fractal workspace"
      >
        <WorkspaceToolbar
          isBusy={isBusy}
          projectName={project.name}
          onBuildIndex={onBuildIndex}
          onValidate={onValidate}
        />
        <CommandStatus error={error} result={commandResult} />
        <div className="editor-stage" aria-label="Editable Fractal page">
          <FractalEditor text={project.activePageSource} />
        </div>
      </section>
    </main>
  );
}

export default Workspace;
