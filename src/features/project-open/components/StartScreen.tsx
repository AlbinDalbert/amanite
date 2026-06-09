import { type FormEvent, useEffect, useState } from "react";
import type { FractalProjectCatalog, FractalProjectSummary } from "@/lib/fractal/types";

const EMPTY_PROJECTS: FractalProjectSummary[] = [];

type StartScreenProps = {
  error: string | null;
  isBusy: boolean;
  projectCatalog: FractalProjectCatalog | null;
  onCreateProject: (projectName: string) => void;
  onOpenProject: (directoryName: string) => void;
  onRefreshProjects: () => void;
};

function StartScreen({
  error,
  isBusy,
  projectCatalog,
  onCreateProject,
  onOpenProject,
  onRefreshProjects
}: StartScreenProps) {
  const [projectName, setProjectName] = useState("");
  const [selectedDirectoryName, setSelectedDirectoryName] = useState("");
  const projects = projectCatalog?.projects ?? EMPTY_PROJECTS;
  const selectedProject = projects.find(
    (project) => project.directoryName === selectedDirectoryName
  );
  const canCreate = projectName.trim().length > 0 && !isBusy;
  const canOpen = Boolean(selectedProject) && !isBusy;
  const emptyProjectMessage =
    projectCatalog === null
      ? isBusy
        ? "Loading projects..."
        : "Project list unavailable."
      : "No Fractal projects found.";

  useEffect(() => {
    if (projects.some((project) => project.directoryName === selectedDirectoryName)) {
      return;
    }

    setSelectedDirectoryName(projects[0]?.directoryName ?? "");
  }, [projects, selectedDirectoryName]);

  function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedProjectName = projectName.trim();
    if (trimmedProjectName.length > 0) {
      onCreateProject(trimmedProjectName);
    }
  }

  function handleOpenSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (selectedProject) {
      onOpenProject(selectedProject.directoryName);
    }
  }

  return (
    <main className="start-screen">
      <section className="start-panel" aria-labelledby="start-title">
        <div className="start-brand">
          <span className="brand-mark" aria-hidden="true" />
          <p>Amanite</p>
        </div>

        <div className="start-copy">
          <h1 id="start-title">Open a Fractal project</h1>
          <p>
            Work with a local Fractal knowledge base, then let its own project
            files define how the page surface should feel.
          </p>
          {projectCatalog ? (
            <p className="library-path" title={projectCatalog.rootPath}>
              {projectCatalog.rootPath}
            </p>
          ) : null}
        </div>

        {error ? <p className="status-message error">{error}</p> : null}

        <div className="project-flow">
          <form className="project-section" onSubmit={handleCreateSubmit}>
            <div className="section-heading">
              <h2>Create project</h2>
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

          <form className="project-section" onSubmit={handleOpenSubmit}>
            <div className="section-heading">
              <h2>Open project</h2>
              <button
                className="ghost-action"
                disabled={isBusy}
                onClick={onRefreshProjects}
                type="button"
              >
                Refresh
              </button>
            </div>

            {projects.length > 0 ? (
              <>
                <label className="project-field">
                  <span>Project</span>
                  <div className="project-field-row">
                    <select
                      disabled={isBusy}
                      onChange={(event) => setSelectedDirectoryName(event.currentTarget.value)}
                      value={selectedDirectoryName}
                    >
                      {projects.map((project) => (
                        <option key={project.directoryName} value={project.directoryName}>
                          {project.name}
                        </option>
                      ))}
                    </select>
                    <button className="secondary-action" type="submit" disabled={!canOpen}>
                      Open
                    </button>
                  </div>
                </label>
                {selectedProject ? (
                  <p className="project-path" title={selectedProject.rootPath}>
                    {selectedProject.rootPath}
                  </p>
                ) : null}
              </>
            ) : (
              <p className="empty-projects">{emptyProjectMessage}</p>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}

export default StartScreen;
