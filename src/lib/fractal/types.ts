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

export type FractalTextPosition = {
  text_node: number;
  offset: number;
};

export type FractalDerivedLink = {
  text: string;
  target: string;
  occurrence: {
    start: FractalTextPosition;
    end: FractalTextPosition;
  };
};

export type FractalLinkCandidate = {
  page: string;
  title: string;
  match_kind: "exact_title" | "exact_stem" | "token_overlap";
  score: number;
};

export type FractalLinkSuggestion = {
  text: string;
  candidates: FractalLinkCandidate[];
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

export type FractalPage = {
  path: string;
  kind: FractalPageKind;
  title?: string | null;
  text: string;
  links: FractalLink[];
  iframes: FractalIframe[];
};

export type FractalProject = {
  name: string;
  rootPath: string;
  pages: FractalPage[];
  folders: string[];
  activePagePath?: string | null;
  activePageSource?: string | null;
  activePageLinks: FractalLink[];
  activePageBacklinks: FractalBacklink[];
  activePageIframes: FractalIframe[];
  activePageIframeBacklinks: FractalIframeBacklink[];
  activePageDerivedLinks: FractalDerivedLink[];
  activePageLinkSuggestions: FractalLinkSuggestion[];
  activePageModifiedMs?: number | null;
};

export type FractalProjectSummary = {
  name: string;
  rootPath: string;
  directoryName: string;
};

export type FractalProjectCatalog = {
  rootPath: string;
  projects: FractalProjectSummary[];
};

export type FractalCommandResult = {
  ok: boolean;
  message: string;
  details?: string | null;
};

export type FractalClient = {
  listProjects: () => Promise<FractalProjectCatalog>;
  createProject: (projectName: string) => Promise<FractalProject>;
  openProject: (directoryName: string) => Promise<FractalProject>;
  openProjectPath: (projectRoot: string) => Promise<FractalProject>;
  openPage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  writePage: (project: FractalProject, source: string) => Promise<FractalProject>;
  createPage: (project: FractalProject, title: string, folderPath?: string) => Promise<FractalProject>;
  importNativePage: (project: FractalProject, title: string, source: string, folderPath?: string) => Promise<FractalProject>;
  createFolder: (project: FractalProject, folderPath: string) => Promise<FractalProject>;
  deleteFolder: (project: FractalProject, folderPath: string) => Promise<FractalProject>;
  movePage: (project: FractalProject, pagePath: string, destination: string) => Promise<FractalProject>;
  deletePage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  validateProject: (project: FractalProject) => Promise<FractalCommandResult>;
  searchProject: (project: FractalProject, query: string) => Promise<FractalSearchResult[]>;
  insertLink: (project: FractalProject, text: string, target: string) => Promise<FractalProject>;
  pageModifiedMs: (project: FractalProject) => Promise<number | null>;
  revealPage: (project: FractalProject, pagePath?: string) => Promise<void>;
};
