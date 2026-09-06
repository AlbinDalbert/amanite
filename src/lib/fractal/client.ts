import { invoke } from "@tauri-apps/api/core";
import type { FractalClient, FractalCommandError, FractalCommandResult, FractalConditionalWriteResult, FractalFolderHtmlExportReport, FractalHtmlExportReport, FractalLoadedPage, FractalMutationBatchResult, FractalMutationResult, FractalPageContentState, FractalProject, FractalProjectCatalog, FractalProjectInspection, FractalRecoveryResult, FractalRepairResult, FractalSearchResult } from "./types";

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function normalizeInspection(value: FractalProjectInspection & { proposed_repairs?: FractalProjectInspection["proposedRepairs"] }): FractalProjectInspection {
  return { ...value, proposedRepairs: value.proposedRepairs ?? value.proposed_repairs ?? [] };
}

async function inspectProject(projectRoot: string) {
  const value = await invokeFractal<FractalProjectInspection & { proposed_repairs?: FractalProjectInspection["proposedRepairs"] }>("fractal_inspect_project", { projectRoot });
  return normalizeInspection(value);
}

async function invokeFractal<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!hasTauriRuntime()) {
    throw new Error("Amanite must run through Tauri to access Fractal projects.");
  }
  return invoke<T>(command, args);
}

export function isFractalCommandError(error: unknown): error is FractalCommandError {
  return Boolean(error && typeof error === "object"
    && "code" in error && typeof error.code === "string"
    && "message" in error && typeof error.message === "string");
}

async function invokeConditional(command: string, args: Record<string, unknown>): Promise<FractalConditionalWriteResult> {
  try {
    return { status: "saved", result: await invokeFractal<FractalMutationResult>(command, args) };
  } catch (error) {
    if (isFractalCommandError(error) && error.code === "conflict") return { status: "conflict", error };
    throw error;
  }
}

export const fractalClient: FractalClient = {
  listProjects: async () => {
    const catalog = await invokeFractal<FractalProjectCatalog>("fractal_list_projects");
    return { ...catalog, projects: catalog.projects.map((project) => ({ ...project, inspection: normalizeInspection(project.inspection) })) };
  },
  createProject: (projectName) =>
    invokeFractal<FractalProject>("fractal_create_project", { projectName }),
  openProject: (directoryName) =>
    invokeFractal<FractalProject>("fractal_open_project", { directoryName }),
  openProjectPath: (projectRoot) =>
    invokeFractal<FractalProject>("fractal_open_project_path", { projectRoot }),
  inspectProject,
  recoverProject: async (projectRoot) => {
    const value = await invokeFractal<FractalRecoveryResult & { inspection: FractalProjectInspection & { proposed_repairs?: FractalProjectInspection["proposedRepairs"] } }>("fractal_recover_project", { projectRoot });
    const report = value.report as typeof value.report & { recovered_transactions?: string[]; cleaned_transactions?: string[] };
    return { ...value, report: { ...report, recoveredTransactions: report.recoveredTransactions ?? report.recovered_transactions ?? [], cleanedTransactions: report.cleanedTransactions ?? report.cleaned_transactions ?? [] }, inspection: normalizeInspection(value.inspection) };
  },
  repairProject: async (projectRoot) => {
    const value = await invokeFractal<FractalRepairResult & { inspection: FractalProjectInspection & { proposed_repairs?: FractalProjectInspection["proposedRepairs"] } }>("fractal_repair_project", { projectRoot });
    return { ...value, inspection: normalizeInspection(value.inspection) };
  },
  recreatePage: (project, pagePath, source) => invokeFractal<FractalMutationResult>("fractal_recreate_page", { projectRoot: project.rootPath, pagePath, source }),
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
  setPageTitle: (project, title, expectedHash) =>
    invokeConditional("fractal_set_page_title", {
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      title
    }),
  setPageContent: (project, contentHtml, expectedHash) =>
    invokeConditional("fractal_set_page_content", {
      contentHtml,
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath
    }),
  setPageStyle: (project, styleCss, expectedHash) =>
    invokeConditional("fractal_set_page_style", {
      expectedHash,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath,
      styleCss
    }),
  setPageMetadata: (project, metadataHtml, expectedHash) =>
    invokeConditional("fractal_set_page_metadata", {
      expectedHash,
      metadataHtml,
      pagePath: project.activePagePath,
      projectRoot: project.rootPath
    }),
  repairPageStructure: (project, pagePath) =>
    invokeFractal<FractalMutationResult>("fractal_repair_page_structure", {
      pagePath,
      projectRoot: project.rootPath
    }),
  createPage: (project, title, folderPath) =>
    invokeFractal<FractalMutationResult>("fractal_create_page", {
      folderPath,
      projectRoot: project.rootPath,
      title
    }),
  duplicatePage: (project, pagePath, title, folderPath) =>
    invokeFractal<FractalMutationBatchResult>("fractal_duplicate_page", {
      folderPath,
      pagePath,
      projectRoot: project.rootPath,
      title
    }),
  createFolder: (project, parent, title) =>
    invokeFractal<FractalMutationResult>("fractal_create_folder", {
      activePagePath: project.activePagePath,
      parent,
      projectRoot: project.rootPath,
      title
    }),
  setFolderTitle: (project, folderPath, title) =>
    invokeFractal<FractalMutationResult>("fractal_set_folder_title", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath,
      title
    }),
  reorderFolder: (project, folderPath, order) =>
    invokeFractal<FractalMutationResult>("fractal_reorder_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      order,
      projectRoot: project.rootPath
    }),
  deleteFolder: (project, folderPath) =>
    invokeFractal<FractalMutationResult>("fractal_delete_folder", {
      activePagePath: project.activePagePath,
      folderPath,
      projectRoot: project.rootPath
    }),
  movePage: (project, pagePath, destinationFolder) =>
    invokeFractal<FractalMutationResult>("fractal_move_page", {
      activePagePath: project.activePagePath,
      destinationFolder,
      pagePath,
      projectRoot: project.rootPath
    }),
  deletePage: (project, pagePath) =>
    invokeFractal<FractalMutationResult>("fractal_delete_page", {
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
    }),
  openExternal: (href) => invokeFractal<void>("fractal_open_external", { href })
};
