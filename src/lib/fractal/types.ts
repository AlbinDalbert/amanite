export type FractalThemeToken =
  | "--project-background"
  | "--project-surface"
  | "--project-text"
  | "--project-muted"
  | "--project-border"
  | "--project-accent";

export type FractalTheme = Partial<Record<FractalThemeToken, string>>;

export type FractalPage = {
  name: string;
  path: string;
};

export type FractalProject = {
  name: string;
  rootPath: string;
  theme?: FractalTheme;
  pages: FractalPage[];
  activePagePath: string;
  activePageSource: string;
  activePageStylesheet: string;
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

export type FractalClient = {
  listProjects: () => Promise<FractalProjectCatalog>;
  createProject: (projectName: string) => Promise<FractalProject>;
  openProject: (directoryName: string) => Promise<FractalProject>;
  validateProject: (project: FractalProject) => Promise<FractalCommandResult>;
  buildIndex: (project: FractalProject) => Promise<FractalCommandResult>;
};
