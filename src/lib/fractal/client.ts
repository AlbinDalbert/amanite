import { invoke } from "@tauri-apps/api/core";
import type { FractalClient, FractalCommandResult, FractalProject, FractalProjectCatalog } from "./types";

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function invokeFractal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error("Amanite must run through Tauri to access Fractal projects.");
  }
  return invoke<T>(command, args);
}

export const fractalClient: FractalClient = {
  listProjects: () => invokeFractal<FractalProjectCatalog>("fractal_list_projects"),
  createProject: (projectName) =>
    invokeFractal<FractalProject>("fractal_create_project", { projectName }),
  openProject: (directoryName) =>
    invokeFractal<FractalProject>("fractal_open_project", { directoryName }),
  openPage: (project, pagePath) =>
    invokeFractal<FractalProject>("fractal_open_page", {
      pagePath,
      projectRoot: project.rootPath
    }),
  writePage: (project, source) =>
    invokeFractal<FractalProject>("fractal_write_page", {
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      source
    }),
  createPage: (project, title, folderPath) =>
    invokeFractal<FractalProject>("fractal_create_page", {
      folderPath,
      projectRoot: project.rootPath,
      title
    }),
  createFolder: (project, folderPath) =>
    invokeFractal<FractalProject>("fractal_create_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath
    }),
  deleteFolder: (project, folderPath) =>
    invokeFractal<FractalProject>("fractal_delete_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath
    }),
  movePage: (project, pagePath, destination) =>
    invokeFractal<FractalProject>("fractal_move_page", {
      activePagePath: project.activePagePath,
      destination,
      pagePath,
      projectRoot: project.rootPath
    }),
  deletePage: (project, pagePath) =>
    invokeFractal<FractalProject>("fractal_delete_page", {
      activePagePath: project.activePagePath,
      pagePath,
      projectRoot: project.rootPath
    }),
  validateProject: (project) =>
    invokeFractal<FractalCommandResult>("fractal_validate_project", {
      projectRoot: project.rootPath
    })
};
