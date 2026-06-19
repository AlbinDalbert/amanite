export type FractalThemeToken =
  | "--project-background"
  | "--project-surface"
  | "--project-text"
  | "--project-muted"
  | "--project-border"
  | "--project-accent";

export type FractalTheme = Partial<Record<FractalThemeToken, string>>;

export type FractalPage = {
  bodyPreview?: string | null;
  name: string;
  path: string;
  summary?: string | null;
};

export type FractalNote = {
  id: string;
  label: string;
  text: string;
};

export type FractalPageLink = {
  href: string;
  text: string;
  scope: string;
};

export type FractalGraphPageLink = {
  page: string;
  text: string;
};

export type FractalProject = {
  name: string;
  rootPath: string;
  theme?: FractalTheme;
  pages: FractalPage[];
  activePagePath: string;
  activePageBodyHtml: string;
  activePageTitle: string;
  activePageSummary: string | null;
  activePageTags: string[];
  activePageNotes: FractalNote[];
  activePageLinks: FractalPageLink[];
  activePageBacklinks: FractalGraphPageLink[];
  activePageOutlinks: FractalGraphPageLink[];
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
  details?: string;
};

export type FractalPageUpdate = {
  title: string;
  bodyHtml: string;
  summary: string;
  tags: string[];
};

export type FractalClient = {
  listProjects: () => Promise<FractalProjectCatalog>;
  createProject: (projectName: string) => Promise<FractalProject>;
  openProject: (directoryName: string) => Promise<FractalProject>;
  openPage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  savePage: (project: FractalProject, update: FractalPageUpdate) => Promise<FractalProject>;
  createPage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  renamePage: (
    project: FractalProject,
    pagePath: string,
    nextPagePath: string
  ) => Promise<FractalProject>;
  deletePage: (project: FractalProject, pagePath: string) => Promise<FractalProject>;
  addNote: (
    project: FractalProject,
    trigger: string,
    content: string
  ) => Promise<FractalProject>;
  updateNote: (
    project: FractalProject,
    note: FractalNote,
    content: string
  ) => Promise<FractalProject>;
  deleteNote: (project: FractalProject, note: FractalNote) => Promise<FractalProject>;
  validateProject: (project: FractalProject) => Promise<FractalCommandResult>;
  buildIndex: (project: FractalProject) => Promise<FractalCommandResult>;
};
