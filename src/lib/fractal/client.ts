import { invoke } from "@tauri-apps/api/core";
import type { FractalClient, FractalCommandResult, FractalConditionalWriteResult, FractalFolderHtmlExportReport, FractalHtmlExportReport, FractalLoadedPage, FractalNativeDocumentImport, FractalPageContentState, FractalProject, FractalProjectCatalog, FractalSearchResult } from "./types";

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
  readPage: (project, pagePath) =>
    invokeFractal<FractalLoadedPage>("fractal_read_page", {
      pagePath,
      projectRoot: project.rootPath
    }),
  writeRawPage: (project, source) =>
    invokeFractal<FractalProject>("fractal_write_raw_page", {
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      source
    }),
  writeRawPageIfUnchanged: (project, source, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_write_raw_page_if_unchanged", {
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      source
    }),
  setPageTitle: (project, title, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_set_page_title", {
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      title
    }),
  setPageContent: (project, contentHtml, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_set_page_content", {
      contentHtml,
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath
    }),
  setPageStyle: (project, styleCss, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_set_page_style", {
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      styleCss
    }),
  setPageMetadata: (project, metadataHtml, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_set_page_metadata", {
      expectedHash,
      metadataHtml,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath
    }),
  setPageHeadLinks: (project, headLinksHtml, expectedHash) =>
    invokeFractal<FractalConditionalWriteResult>("fractal_set_page_head_links", {
      expectedHash,
      headLinksHtml,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath
    }),
  repairPageStructure: (project, pagePath) =>
    invokeFractal<FractalProject>("fractal_repair_page_structure", {
      pagePath,
      projectRoot: project.rootPath
    }),
  createPage: (project, title, folderPath) =>
    invokeFractal<FractalProject>("fractal_create_page", {
      folderPath,
      projectRoot: project.rootPath,
      title
    }),
  importNativePage: (project, title, sections: FractalNativeDocumentImport, folderPath) =>
    invokeFractal<FractalProject>("fractal_import_native_page", {
      contentHtml: sections.contentHtml,
      folderPath,
      headLinksHtml: sections.headLinksHtml,
      metadataHtml: sections.metadataHtml,
      projectRoot: project.rootPath,
      styleCss: sections.styleCss,
      title
    }),
  createFolder: (project, folderPath) =>
    invokeFractal<FractalProject>("fractal_create_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath
    }),
  setFolderTitle: (project, folderPath, title) =>
    invokeFractal<FractalProject>("fractal_set_folder_title", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath,
      title
    }),
  reorderFolder: (project, folderPath, order) =>
    invokeFractal<FractalProject>("fractal_reorder_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      order,
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
  exportFolderHtml: (project, folderPath, output, options) =>
    invokeFractal<FractalFolderHtmlExportReport>("fractal_export_folder_html", {
      folderPath,
      includeDerivedLinks: options.includeDerivedLinks,
      force: options.force,
      numberSections: options.numberSections,
      output,
      projectRoot: project.rootPath,
      selections: options.selections
    }),
  revealPage: (project, pagePath) =>
    invokeFractal<void>("fractal_reveal_page", {
      pagePath,
      projectRoot: project.rootPath
    })
};
