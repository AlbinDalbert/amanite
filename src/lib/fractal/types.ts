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

export type FractalIframeTarget =
  | { kind: "internal"; value: string }
  | { kind: "internal_file"; value: string }
  | { kind: "external"; value: string }
  | { kind: "inline" }
  | { kind: "missing" }
  | { kind: "broken"; value: string };

export type FractalIframe = {
  src?: string | null;
  title?: string | null;
  sandbox?: string | null;
  target: FractalIframeTarget;
};

export type FractalIframeBacklink = {
  page: string;
  title?: string | null;
};

export type FractalPageKind = "native" | "raw";

export type FractalNativeDocumentParts = {
  title: string;
  titleHash: string;
  contentHtml: string;
  contentHash: string;
  styleCss: string;
  styleHash: string;
  metadataHtml: string;
  metadataHash: string;
  headLinksHtml: string;
  headLinksHash: string;
  sourceHash: string;
};

export type FractalNativeDocumentHashes = Pick<
  FractalNativeDocumentParts,
  "titleHash" | "contentHash" | "styleHash" | "metadataHash" | "headLinksHash" | "sourceHash"
>;

export type FractalNativeSection = "title" | "content" | "style" | "metadata" | "headLinks";
export type FractalNativeSectionEdits = Partial<Record<FractalNativeSection, string>>;

export type FractalNativeDocumentImport = Pick<
  FractalNativeDocumentParts,
  "contentHtml" | "styleCss" | "metadataHtml" | "headLinksHtml"
>;

export type FractalPage = {
  path: string;
  contentHash: string;
  kind: FractalPageKind;
  title?: string | null;
  text: string;
  links: FractalLink[];
  iframes: FractalIframe[];
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
  activePageIframes: FractalIframe[];
  activePageIframeBacklinks: FractalIframeBacklink[];
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
  kind: FractalPageKind;
  source: string;
  links: FractalLink[];
  backlinks: FractalBacklink[];
  iframes: FractalIframe[];
  iframeBacklinks: FractalIframeBacklink[];
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
  writeRawPage: (project: FractalProject, source: string) => Promise<FractalProject>;
  writeRawPageIfUnchanged: (project: FractalProject, source: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageTitle: (project: FractalProject, title: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageContent: (project: FractalProject, contentHtml: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageStyle: (project: FractalProject, styleCss: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageMetadata: (project: FractalProject, metadataHtml: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  setPageHeadLinks: (project: FractalProject, headLinksHtml: string, expectedHash: string) => Promise<FractalConditionalWriteResult>;
  repairPageStructure: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  createPage: (project: FractalProject, title: string, folderPath?: string) => Promise<FractalProject>;
  importNativePage: (project: FractalProject, title: string, sections: FractalNativeDocumentImport, folderPath?: string) => Promise<FractalProject>;
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
