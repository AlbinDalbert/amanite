export type FractalLinkTarget =
  | { kind: "internal"; value: string }
  | { kind: "internal_file"; value: string }
  | { kind: "external"; value: string }
  | { kind: "fragment"; value: string }
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
  | { status: "saved"; project: FractalProject }
  | { status: "conflict"; message: string };

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
  repairPageStructure: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  createPage: (project: FractalProject, title: string, folderPath?: string) => Promise<FractalProject>;
  duplicatePage: (project: FractalProject, pagePath: string, title: string, folderPath?: string) => Promise<FractalProject>;
  createFolder: (project: FractalProject, folderPath: string) => Promise<FractalProject>;
  setFolderTitle: (project: FractalProject, folderPath: string, title: string) => Promise<FractalProject>;
  reorderFolder: (project: FractalProject, folderPath: string, order: string[]) => Promise<FractalProject>;
  deleteFolder: (project: FractalProject, folderPath: string) => Promise<FractalProject>;
  movePage: (project: FractalProject, pagePath: string, destination: string) => Promise<FractalProject>;
  deletePage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  validateProject: (project: FractalProject) => Promise<FractalCommandResult>;
  searchProject: (project: FractalProject, query: string) => Promise<FractalSearchResult[]>;
  pageContentStates: (project: FractalProject, pagePaths: string[]) => Promise<FractalPageContentState[]>;
  exportHtml: (project: FractalProject, pagePath: string, output: string, includeDerivedLinks: boolean) => Promise<FractalHtmlExportReport>;
  exportFolderHtml: (project: FractalProject, folderPath: string, output: string, options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport>;
  revealPage: (project: FractalProject, pagePath?: string) => Promise<void>;
};
