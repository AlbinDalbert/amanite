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
};

function StartScreen({
  error,
  isBusy,
  projectCatalog,
  onCreateProject,
  onCloseRequest,
  onOpenProject,
  onOpenProjectFolder,
  onOpenSettings,
  onRefreshProjects
}: StartScreenProps) {
  const [projectName, setProjectName] = useState("");
  const projects = projectCatalog?.projects ?? EMPTY_PROJECTS;
  const canCreate = projectName.trim().length > 0 && !isBusy;
  const emptyProjectMessage =
    projectCatalog === null
      ? isBusy
        ? "Loading projects..."
        : "Project list unavailable."
      : "No Fractal projects found.";

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedProjectName = projectName.trim();
    if (trimmedProjectName.length > 0) {
      onCreateProject(trimmedProjectName);
    }
  }

  return (
    <main className="start-screen">
      <div
        className="start-titlebar"
        data-tauri-drag-region
        onMouseDown={handleWindowDragMouseDown}
      >
        <button className="start-settings-button" onClick={onOpenSettings} type="button">Settings</button>
        <WindowControls onCloseRequest={onCloseRequest} />
      </div>

      <section className="start-panel" aria-labelledby="start-title">
        <div className="start-brand">
          <span className="brand-mark" aria-hidden="true" />
          <p>Amanite</p>
        </div>

        <div className="start-copy">
          <h1 id="start-title">Open a Fractal project</h1>
          <p className="start-description">Write, organize, and preview local Fractal pages.</p>
          {projectCatalog ? (
            <>
              <p className="library-path" title={projectCatalog.rootPath}>{projectCatalog.rootPath}</p>
              {projectCatalog.issues.length ? (
                <p className="catalog-warning" title={projectCatalog.issues.join("\n")}>
                  {projectCatalog.issues.length} {projectCatalog.issues.length === 1 ? "project was" : "projects were"} skipped because they could not be opened.
                </p>
              ) : null}
            </>
          ) : null}
        </div>

        {error ? <p className="status-message error">{error}</p> : null}

        <div className="project-flow">
          <form className="project-section create-project-section" onSubmit={handleCreateSubmit}>
            <div className="section-heading">
              <h2>Create new project</h2>
            </div>
            <label className="project-field">
              <span>Project name</span>
              <div className="project-field-row">
                <input
                  autoComplete="off"
                  disabled={isBusy}
                  onChange={(event) => setProjectName(event.currentTarget.value)}
                  placeholder="Field notes"
                  type="text"
                  value={projectName}
                />
                <button className="primary-action" type="submit" disabled={!canCreate}>
                  Create
                </button>
              </div>
            </label>
          </form>

          <section className="project-section project-list-section">
            <div className="section-heading">
              <h2>Open project</h2>
              <div className="section-heading-actions">
                <button className="ghost-action" disabled={isBusy} onClick={onOpenProjectFolder} type="button">Open folder</button>
                <button className="ghost-action" disabled={isBusy} onClick={onRefreshProjects} type="button">Refresh</button>
              </div>
            </div>

            {projects.length > 0 ? (
              <div className="project-picker project-list" role="group" aria-label="Projects">
                {projects.map((project) => (
                  <button
                    className="project-option project-list-option"
                    disabled={isBusy}
                    key={project.directoryName}
                    onClick={() => onOpenProject(project.directoryName)}
                    title={project.rootPath}
                    type="button"
                  >
                    <span className="project-option-main">
                      <strong>{project.name}</strong>
                      <small>{project.directoryName}</small>
                    </span>
                    <span className="project-option-action" aria-hidden="true">
                      Open
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="empty-projects">{emptyProjectMessage}</p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

export default StartScreen;
