import { invoke } from "@tauri-apps/api/core";
import { createMockFractalClient } from "./mockClient";
import type {
  FractalClient,
  FractalCommandResult,
  FractalProject,
  FractalProjectCatalog
} from "./types";

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function shouldUseBrowserMock() {
  return (
    !hasTauriRuntime() &&
    (import.meta.env.DEV || import.meta.env.VITE_AMANITE_WEB_MOCK === "1")
  );
}

async function invokeFractal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error(
      "Amanite must be run through Tauri to load local Fractal project files. Run pnpm run dev for the browser mock, or set VITE_AMANITE_WEB_MOCK=1 for preview builds."
    );
  }

  return invoke<T>(command, args);
}

const tauriFractalClient: FractalClient = {
  listProjects() {
    return invokeFractal<FractalProjectCatalog>("fractal_list_projects");
  },
  createProject(projectName) {
    return invokeFractal<FractalProject>("fractal_create_project", {
      projectName
    });
  },
  openProject(directoryName) {
    return invokeFractal<FractalProject>("fractal_open_project", {
      directoryName
    });
  },
  openPage(project, pagePath) {
    return invokeFractal<FractalProject>("fractal_open_page", {
      pagePath,
      projectRoot: project.rootPath
    });
  },
  savePage(project, update) {
    return invokeFractal<FractalProject>("fractal_update_page", {
      bodyHtml: update.bodyHtml,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      summary: update.summary,
      tags: update.tags,
      title: update.title
    });
  },
  createPage(project, pagePath) {
    return invokeFractal<FractalProject>("fractal_create_page", {
      pagePath,
      projectRoot: project.rootPath
    });
  },
  renamePage(project, pagePath, nextPagePath) {
    return invokeFractal<FractalProject>("fractal_rename_page", {
      activePagePath: project.activePagePath,
      nextPagePath,
      pagePath,
      projectRoot: project.rootPath
    });
  },
  deletePage(project, pagePath) {
    return invokeFractal<FractalProject>("fractal_delete_page", {
      activePagePath: project.activePagePath,
      pagePath,
      projectRoot: project.rootPath
    });
  },
  addNote(project, trigger, content) {
    return invokeFractal<FractalProject>("fractal_add_note", {
      content,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      trigger
    });
  },
  updateNote(project, note, content) {
    return invokeFractal<FractalProject>("fractal_update_note", {
      content,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      trigger: note.label
    });
  },
  deleteNote(project, note) {
    return invokeFractal<FractalProject>("fractal_delete_note", {
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      trigger: note.label
    });
  },
  validateProject(project) {
    return invokeFractal<FractalCommandResult>("fractal_validate_project", {
      projectRoot: project.rootPath
    });
  },
  buildIndex(project) {
    return invokeFractal<FractalCommandResult>("fractal_build_index", {
      projectRoot: project.rootPath
    });
  }
};

const mockFractalClient = createMockFractalClient();

function activeFractalClient() {
  return shouldUseBrowserMock() ? mockFractalClient : tauriFractalClient;
}

export const fractalClient: FractalClient = {
  listProjects() {
    return activeFractalClient().listProjects();
  },
  createProject(projectName) {
    return activeFractalClient().createProject(projectName);
  },
  openProject(directoryName) {
    return activeFractalClient().openProject(directoryName);
  },
  openPage(project, pagePath) {
    return activeFractalClient().openPage(project, pagePath);
  },
  savePage(project, update) {
    return activeFractalClient().savePage(project, update);
  },
  createPage(project, pagePath) {
    return activeFractalClient().createPage(project, pagePath);
  },
  renamePage(project, pagePath, nextPagePath) {
    return activeFractalClient().renamePage(project, pagePath, nextPagePath);
  },
  deletePage(project, pagePath) {
    return activeFractalClient().deletePage(project, pagePath);
  },
  addNote(project, trigger, content) {
    return activeFractalClient().addNote(project, trigger, content);
  },
  updateNote(project, note, content) {
    return activeFractalClient().updateNote(project, note, content);
  },
  deleteNote(project, note) {
    return activeFractalClient().deleteNote(project, note);
  },
  validateProject(project) {
    return activeFractalClient().validateProject(project);
  },
  buildIndex(project) {
    return activeFractalClient().buildIndex(project);
  }
};
