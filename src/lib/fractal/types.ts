export type FractalLinkTarget =
  | { kind: "resolved"; value: string }
  | { kind: "broken"; value: string };

export type FractalLink = {
  href: string;
  text: string;
  target: FractalLinkTarget;
};

export type FractalBacklink = {
  page: string;
  text: string;
};

export type FractalSearchResult = {
  path: string;
  title?: string | null;
  snippet: string;
};

export type FractalNativeDocumentParts = {
  title: string;
  titleHash: string;
  contentHtml: string;
  contentHash: string;
  styleCss: string;
  styleHash: string;
  metadataHtml: string;
  metadataHash: string;
  sourceHash: string;
};

export type FractalNativeDocumentHashes = Pick<
  FractalNativeDocumentParts,
  "titleHash" | "contentHash" | "styleHash" | "metadataHash" | "sourceHash"
>;

export type FractalNativeSection = "title" | "content" | "style" | "metadata";
export type FractalNativeSectionEdits = Partial<Record<FractalNativeSection, string>>;

export type FractalPage = {
  path: string;
  contentHash: string;
  title?: string | null;
  text: string;
  links: FractalLink[];
};

export type FractalFolderChildKind = "folder" | "native";
export type FractalFolderChildStatus = "present" | "missing";

export type FractalFolderChild = {
  name: string;
  kind: FractalFolderChildKind;
  status: FractalFolderChildStatus;
};

export type FractalFolderIssue = {
  name: string;
  message: string;
};

export type FractalFolder = {
  path: string;
  title: string;
  order?: string[] | null;
  children: FractalFolderChild[];
  issues: FractalFolderIssue[];
};

export type FractalProject = {
  name: string;
  version: number;
  rootPath: string;
  pages: FractalPage[];
  folders: FractalFolder[];
  activePagePath?: string | null;
  activePageSource?: string | null;
  activePageLinks: FractalLink[];
  activePageBacklinks: FractalBacklink[];
  activePageContentHash?: string | null;
  activePageNativeDocumentParts?: FractalNativeDocumentParts | null;
};

export type FractalProjectSummary = {
  name: string;
  rootPath: string;
  directoryName: string;
};

export type FractalProjectCatalog = {
  rootPath: string;
  projects: FractalProjectSummary[];
  issues: string[];
};

export type FractalCommandResult = {
  ok: boolean;
  message: string;
  details?: string | null;
};

export type FractalPageContentState = {
  path: string;
  contentHash: string | null;
  nativeDocumentHashes?: FractalNativeDocumentHashes | null;
};

export type FractalHtmlExportReport = {
  output: string;
  references: string[];
};

export type FractalFolderHtmlExportOptions = {
  selections: string[];
  numberSections: boolean;
  includeDerivedLinks: boolean;
  force: boolean;
};

export type FractalSkippedExportPage = {
  path: string;
  reason: string;
};

export type FractalFolderHtmlExportReport = {
  output: string;
  pages: string[];
  skipped: FractalSkippedExportPage[];
  references: string[];
};

export type FractalLoadedPage = {
  path: string;
  source: string;
  links: FractalLink[];
  backlinks: FractalBacklink[];
  contentHash: string;
  nativeDocumentParts?: FractalNativeDocumentParts | null;
};

export type FractalConditionalWriteResult =
  | { status: "saved"; result: FractalMutationResult }
  | { status: "conflict"; error: FractalCommandError };

export type FractalErrorCode =
  | "already_exists"
  | "conflict"
  | "invalid_input"
  | "invalid_project"
  | "indeterminate"
  | "io"
  | "json"
  | "mutation_committed"
  | "not_found"
  | "path"
  | "recovery_required"
  | "unsupported_version"
  | "utf8";

export type FractalCommandError = {
  code: FractalErrorCode;
  message: string;
};

export type FractalProjectEntryKind = "file" | "directory";

export type FractalProjectChange =
  | { change: "created"; path: string; entry: FractalProjectEntryKind; after_hash?: string }
  | { change: "updated"; path: string; before_hash: string; after_hash: string }
  | { change: "moved"; from: string; to: string; entry: FractalProjectEntryKind; before_hash?: string; after_hash?: string }
  | { change: "deleted"; path: string; entry: FractalProjectEntryKind; before_hash?: string };

export type FractalMutationKind =
  | "create_page"
  | "create_folder"
  | "recreate_page"
  | "set_page_content"
  | "set_page_style"
  | "set_page_metadata"
  | "repair_page_structure"
  | "set_page_title"
  | "move_page"
  | "delete_pages"
  | "insert_link"
  | "set_folder_title"
  | "reorder_folder"
  | "move_folder"
  | "delete_folder"
  | "repair_project";

export type FractalOperationWarning = {
  code: "cleanup_pending";
  message: string;
};

export type FractalMutationReceipt = {
  operation: FractalMutationKind;
  changes: FractalProjectChange[];
  warnings: FractalOperationWarning[];
};

export type FractalMutationResult = {
  project: FractalProject;
  receipt: FractalMutationReceipt;
};

export type FractalMutationBatchResult = {
  project: FractalProject;
  receipts: FractalMutationReceipt[];
  failure?: FractalCommandError;
};

export type FractalClient = {
  listProjects: () => Promise<FractalProjectCatalog>;
  createProject: (projectName: string) => Promise<FractalProject>;
  openProject: (directoryName: string) => Promise<FractalProject>;
  openProjectPath: (projectRoot: string) => Promise<FractalProject>;
  openPage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  readPage: (project: FractalProject, pagePath: string) => Promise<FractalLoadedPage>;
  setPageTitle: (project: FractalProject, title: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageContent: (project: FractalProject, contentHtml: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageStyle: (project: FractalProject, styleCss: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageMetadata: (project: FractalProject, metadataHtml: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  repairPageStructure: (project: FractalProject, pagePath: string) => Promise<FractalMutationResult>;
  createPage: (project: FractalProject, title: string, folderPath?: string) => Promise<FractalMutationResult>;
  duplicatePage: (project: FractalProject, pagePath: string, title: string, folderPath?: string) => Promise<FractalMutationBatchResult>;
  createFolder: (project: FractalProject, parent: string, title: string) => Promise<FractalMutationResult>;
  setFolderTitle: (project: FractalProject, folderPath: string, title: string) => Promise<FractalMutationResult>;
  reorderFolder: (project: FractalProject, folderPath: string, order: string[]) => Promise<FractalMutationResult>;
  deleteFolder: (project: FractalProject, folderPath: string) => Promise<FractalMutationResult>;
  movePage: (project: FractalProject, pagePath: string, destinationFolder: string) => Promise<FractalMutationResult>;
  deletePage: (project: FractalProject, pagePath: string) => Promise<FractalMutationResult>;
  validateProject: (project: FractalProject) => Promise<FractalCommandResult>;
  searchProject: (project: FractalProject, query: string) => Promise<FractalSearchResult[]>;
  pageContentStates: (project: FractalProject, pagePaths: string[]) => Promise<FractalPageContentState[]>;
  exportHtml: (project: FractalProject, pagePath: string, output: string, includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport>;
  exportFolderHtml: (project: FractalProject, folderPath: string, output: string, options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport>;
  revealPage: (project: FractalProject, pagePath?: string) => Promise<void>;
  openExternal: (href: string) => Promise<void>;
};
