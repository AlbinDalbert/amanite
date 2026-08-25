import { invoke } from "@tauri-apps/api/core";
import type { FractalClient, FractalCommandResult, FractalConditionalWriteResult, FractalHtmlExportReport, FractalPageContentState, FractalProject, FractalProjectCatalog, FractalSearchResult } from "./types";

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
  openProjectPath: (projectRoot) =>
    invokeFractal<FractalProject>("fractal_open_project_path", { projectRoot }),
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
  writePageIfUnchanged: (project, source, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_write_page_if_unchanged", {
      expectedHash,
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
  importNativePage: (project, title, source, folderPath) =>
    invokeFractal<FractalProject>("fractal_import_native_page", {
      folderPath,
      projectRoot: project.rootPath,
      source,
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
    }),
  searchProject: (project, query) =>
    invokeFractal<FractalSearchResult[]>("fractal_search_project", {
      projectRoot: project.rootPath,
      query
    }),
  pageContentStates: (project, pagePaths) =>
    invokeFractal<FractalPageContentState[]>("fractal_page_content_states", {
      pagePaths,
      projectRoot: project.rootPath
    }),
  exportHtml: (project, pagePath, output, includeDerivedLinks) =>
    invokeFractal<FractalHtmlExportReport>("fractal_export_html", {
      includeDerivedLinks,
      output,
      pagePath,
      projectRoot: project.rootPath
    }),
  revealPage: (project, pagePath) =>
    invokeFractal<void>("fractal_reveal_page", {
      pagePath,
      projectRoot: project.rootPath
    })
};
