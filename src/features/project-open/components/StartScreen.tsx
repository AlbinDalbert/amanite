import { type FormEvent, useState } from "react";
import WindowControls, { handleWindowDragMouseDown } from "@/components/ui/WindowControls";
import type { FractalProjectCatalog, FractalProjectSummary } from "@/lib/fractal/types";

const EMPTY_PROJECTS: FractalProjectSummary[] = [];

type StartScreenProps = {
  error: string | null;
  isBusy: boolean;
  projectCatalog: FractalProjectCatalog | null;
  onCreateProject: (projectName: string) => void;
  onCloseRequest: () => void;
  onOpenProject: (directoryName: string) => void;
  onOpenProjectFolder: () => void;
  onOpenSettings: () => void;
  onRefreshProjects: () => void;
  onRecoverProject: (projectRoot: string) => void;
};

function ProjectListEntry({ isBusy, onOpenProject, onRecoverProject, project }: {
  isBusy: boolean;
  onOpenProject: (directoryName: string) => void;
  onRecoverProject: (projectRoot: string) => void;
  project: FractalProjectSummary;
}) {
  const canRecover = !project.inspection.openable
    && project.inspection.recovery.some((item) => item.status !== "malformed");
  const action = project.inspection.healthy ? "Open" : project.inspection.openable ? "Open with issues" : "Blocked";
  return (
    <div className="project-list-entry">
      <button
        className="project-option project-list-option project-option-main"
        disabled={isBusy || !project.inspection.openable}
        onClick={() => onOpenProject(project.directoryName)}
        title={project.rootPath}
        type="button"
      >
        <span>
          <strong>{project.name}</strong>
          <small>{project.directoryName}</small>
        </span>
        <span className="project-option-action" aria-hidden="true">{action}</span>
      </button>
      {canRecover ? <button className="ghost-action" disabled={isBusy} onClick={() => onRecoverProject(project.rootPath)} type="button">Recover</button> : null}
      {project.inspection.issues.length ? <small className="catalog-warning">{project.inspection.issues.map((issue) => issue.message).join(" ")}</small> : null}
    </div>
  );
}

function ProjectList({ emptyMessage, isBusy, onOpenProject, onRecoverProject, projects }: {
  emptyMessage: string;
  isBusy: boolean;
  onOpenProject: (directoryName: string) => void;
  onRecoverProject: (projectRoot: string) => void;
  projects: FractalProjectSummary[];
}) {
  if (!projects.length) return <p className="empty-projects">{emptyMessage}</p>;
  return (
    <div className="project-picker project-list" role="group" aria-label="Projects">
      {projects.map((project) => <ProjectListEntry isBusy={isBusy} key={project.directoryName} onOpenProject={onOpenProject} onRecoverProject={onRecoverProject} project={project} />)}
    </div>
  );
}

function StartTitlebar({ onCloseRequest, onOpenSettings }: Pick<StartScreenProps, "onCloseRequest" | "onOpenSettings">) {
  return (
    <div className="start-titlebar" data-tauri-drag-region onMouseDown={handleWindowDragMouseDown}>
      <button className="start-settings-button" onClick={onOpenSettings} type="button">Settings</button>
      <WindowControls onCloseRequest={onCloseRequest} />
    </div>
  );
}

function StartIntro({ projectCatalog }: { projectCatalog: FractalProjectCatalog | null }) {
  return (
    <div className="start-copy">
      <h1 id="start-title">Open a Fractal project</h1>
      <p className="start-description">Write, organize, and preview local Fractal pages.</p>
      {projectCatalog ? (
        <>
          <p className="library-path" title={projectCatalog.rootPath}>{projectCatalog.rootPath}</p>
          {projectCatalog.issues.length ? <p className="catalog-warning" title={projectCatalog.issues.join("\n")}>{projectCatalog.issues.length} {projectCatalog.issues.length === 1 ? "project was" : "projects were"} skipped because they could not be opened.</p> : null}
        </>
      ) : null}
    </div>
  );
}

function CreateProjectSection({ isBusy, onCreateProject }: Pick<StartScreenProps, "isBusy" | "onCreateProject">) {
  const [projectName, setProjectName] = useState("");
  const canCreate = projectName.trim().length > 0 && !isBusy;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedProjectName = projectName.trim();
    if (trimmedProjectName) onCreateProject(trimmedProjectName);
  }

  return (
    <form className="project-section create-project-section" onSubmit={handleSubmit}>
      <div className="section-heading"><h2>Create new project</h2></div>
      <label className="project-field">
        <span>Project name</span>
        <div className="project-field-row">
          <input autoComplete="off" disabled={isBusy} onChange={(event) => setProjectName(event.currentTarget.value)} placeholder="Field notes" type="text" value={projectName} />
          <button className="primary-action" type="submit" disabled={!canCreate}>Create</button>
        </div>
      </label>
    </form>
  );
}

function OpenProjectSection({ emptyMessage, isBusy, onOpenProject, onOpenProjectFolder, onRecoverProject, onRefreshProjects, projects }: {
  emptyMessage: string;
  isBusy: boolean;
  onOpenProject: StartScreenProps["onOpenProject"];
  onOpenProjectFolder: StartScreenProps["onOpenProjectFolder"];
  onRecoverProject: StartScreenProps["onRecoverProject"];
  onRefreshProjects: StartScreenProps["onRefreshProjects"];
  projects: FractalProjectSummary[];
}) {
  return (
    <section className="project-section project-list-section">
      <div className="section-heading">
        <h2>Open project</h2>
        <div className="section-heading-actions">
          <button className="ghost-action" disabled={isBusy} onClick={onOpenProjectFolder} type="button">Open folder</button>
          <button className="ghost-action" disabled={isBusy} onClick={onRefreshProjects} type="button">Refresh</button>
        </div>
      </div>
      <ProjectList emptyMessage={emptyMessage} isBusy={isBusy} onOpenProject={onOpenProject} onRecoverProject={onRecoverProject} projects={projects} />
    </section>
  );
}

function emptyProjectMessage(projectCatalog: FractalProjectCatalog | null, isBusy: boolean) {
  if (projectCatalog) return "No Fractal projects found.";
  return isBusy ? "Loading projects..." : "Project list unavailable.";
}

function StartScreen({
  error,
  isBusy,
  projectCatalog,
  onCreateProject,
  onCloseRequest,
  onOpenProject,
  onOpenProjectFolder,
  onOpenSettings,
  onRefreshProjects,
  onRecoverProject
}: StartScreenProps) {
  const projects = projectCatalog?.projects ?? EMPTY_PROJECTS;

  return (
    <main className="start-screen">
      <StartTitlebar onCloseRequest={onCloseRequest} onOpenSettings={onOpenSettings} />

      <section className="start-panel" aria-labelledby="start-title">
        <div className="start-brand">
          <span className="brand-mark" aria-hidden="true" />
          <p>Amanite</p>
        </div>

        <StartIntro projectCatalog={projectCatalog} />

        {error ? <p className="status-message error">{error}</p> : null}

        <div className="project-flow">
          <CreateProjectSection isBusy={isBusy} onCreateProject={onCreateProject} />
          <OpenProjectSection emptyMessage={emptyProjectMessage(projectCatalog, isBusy)} isBusy={isBusy} onOpenProject={onOpenProject} onOpenProjectFolder={onOpenProjectFolder} onRecoverProject={onRecoverProject} onRefreshProjects={onRefreshProjects} projects={projects} />
        </div>
      </section>
    </main>
  );
}

export default StartScreen;
