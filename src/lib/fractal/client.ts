import { invoke } from "@tauri-apps/api/core";
import type {
  FractalClient,
  FractalCommandResult,
  FractalProject,
  FractalProjectCatalog
} from "./types";

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeFractal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error(
      "Amanite must be run through the Tauri desktop app so it can access the Fractal backend. For UI debugging, use pnpm run tauri:webdriver:open or pnpm run tauri:webdriver:smoke."
    );
  }

  return invoke<T>(command, args);
}

export const fractalClient: FractalClient = {
  listProjects() {
    return invokeFractal<FractalProjectCatalog>("fractal_list_projects");
  },
  createProject(projectName) {
    return invokeFractal<FractalProject>("fractal_create_project", { projectName });
  },
  openProject(directoryName) {
    return invokeFractal<FractalProject>("fractal_open_project", { directoryName });
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
  createPage(project, pageTitle) {
    return invokeFractal<FractalProject>("fractal_create_page", {
      pagePath: pageTitle,
      projectRoot: project.rootPath
    });
  },
  createDirectory(project, parentPath, directoryName) {
    return invokeFractal<FractalProject>("fractal_create_directory", {
      directoryName,
      parentPath,
      projectRoot: project.rootPath
    });
  },
  deleteDirectory(project, directoryPath) {
    return invokeFractal<FractalProject>("fractal_delete_directory", {
      activePagePath: project.activePagePath,
      directoryPath,
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
