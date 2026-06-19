import type {
  FractalClient,
  FractalCommandResult,
  FractalGraphPageLink,
  FractalNote,
  FractalPage,
  FractalPageLink,
  FractalProject,
  FractalProjectCatalog,
  FractalProjectSummary,
  FractalTheme
} from "./types";

type StoredMockPage = {
  bodyHtml: string;
  notes?: FractalNote[];
  path: string;
  summary: string | null;
  tags: string[];
  title: string;
};

type StoredMockProject = {
  directoryName: string;
  name: string;
  pages: StoredMockPage[];
  rootPath: string;
  theme?: FractalTheme;
};

type MockState = {
  projects: StoredMockProject[];
  version: 1;
};

const MOCK_ROOT_PATH = "browser-mock://amanite/projects";
const STORAGE_KEY = "amanite.webMock.v1";

let memoryState: MockState | null = null;

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function directoryNameFromProjectName(projectName: string) {
  const directoryName = projectName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!directoryName) {
    throw new Error("Project name must include at least one letter or number.");
  }

  return directoryName;
}

function ensureUniqueDirectoryName(projects: StoredMockProject[], projectName: string) {
  const baseDirectoryName = directoryNameFromProjectName(projectName);
  let directoryName = baseDirectoryName;
  let index = 2;

  while (projects.some((project) => project.directoryName === directoryName)) {
    directoryName = `${baseDirectoryName}-${index}`;
    index += 1;
  }

  return directoryName;
}

function projectRoot(directoryName: string) {
  return `${MOCK_ROOT_PATH}/${directoryName}`;
}

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function titleFromPagePath(pagePath: string) {
  const fileName = fileNameFromPath(pagePath).replace(/\.html$/i, "");

  return fileName
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ") || "Untitled";
}

function normalizePageReference(pagePath: string) {
  let normalized = pagePath.trim().replaceAll("\\", "/");

  while (normalized.startsWith("./")) {
    normalized = normalized.slice(2);
  }

  normalized = normalized.replace(/^pages\//, "").replace(/^\/+/, "");

  const parts = normalized.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Choose a valid page path inside the mock project.");
  }

  normalized = parts.join("/");

  if (!fileNameFromPath(normalized).includes(".")) {
    normalized = `${normalized}.html`;
  }

  return normalized;
}

function normalizeLinkHref(href: string) {
  if (/^(?:[a-z]+:|#)/i.test(href)) {
    return null;
  }

  const pagePath = href.split("#", 1)[0].split("?", 1)[0];
  if (!pagePath) {
    return null;
  }

  try {
    return normalizePageReference(pagePath);
  } catch {
    return null;
  }
}

function sortPages(pages: StoredMockPage[]) {
  return [...pages].sort((left, right) => left.path.localeCompare(right.path));
}

function stripHtml(html: string) {
  if (typeof DOMParser !== "undefined") {
    const dom = new DOMParser().parseFromString(html, "text/html");
    return (dom.body.textContent ?? "").replace(/\s+/g, " ").trim();
  }

  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function summaryFromBody(bodyHtml: string) {
  const text = stripHtml(bodyHtml);

  if (!text) {
    return null;
  }

  return text.length > 140 ? `${text.slice(0, 137)}...` : text;
}

function normalizeTags(tags: string[]) {
  const seenTags = new Set<string>();
  const normalizedTags: string[] = [];

  for (const tag of tags) {
    const normalizedTag = tag.trim();
    const key = normalizedTag.toLowerCase();

    if (normalizedTag && !seenTags.has(key)) {
      seenTags.add(key);
      normalizedTags.push(normalizedTag);
    }
  }

  return normalizedTags;
}

function noteIdFromTrigger(trigger: string) {
  const slug = trigger
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    throw new Error("Select text with at least one letter or number before adding a note.");
  }

  return `note-${slug}`;
}

function linkNoteTriggerInBodyHtml(bodyHtml: string, trigger: string, noteId: string) {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    return bodyHtml;
  }

  const dom = new DOMParser().parseFromString(`<main>${bodyHtml}</main>`, "text/html");
  const main = dom.body.querySelector("main");
  if (
    !main ||
    Array.from(main.querySelectorAll<HTMLAnchorElement>("a[href]")).some(
      (link) => link.getAttribute("href") === `#${noteId}`
    )
  ) {
    return bodyHtml;
  }

  const needle = trigger.trim().toLowerCase();
  if (!needle) {
    return bodyHtml;
  }

  const walker = dom.createTreeWalker(main, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();

  while (textNode) {
    const parent = textNode.parentElement;
    if (!parent?.closest("a, code, pre, script, style, textarea")) {
      const text = textNode.textContent ?? "";
      const index = text.toLowerCase().indexOf(needle);

      if (index >= 0) {
        const before = text.slice(0, index);
        const match = text.slice(index, index + needle.length);
        const after = text.slice(index + needle.length);
        const link = dom.createElement("a");

        link.href = `#${noteId}`;
        link.setAttribute("data-fractal-link", "note");
        link.textContent = match;

        textNode.parentNode?.insertBefore(dom.createTextNode(before), textNode);
        textNode.parentNode?.insertBefore(link, textNode);
        textNode.parentNode?.insertBefore(dom.createTextNode(after), textNode);
        textNode.parentNode?.removeChild(textNode);
        return main.innerHTML;
      }
    }

    textNode = walker.nextNode();
  }

  return bodyHtml;
}

function unlinkNoteInBodyHtml(bodyHtml: string, noteId: string) {
  if (typeof DOMParser === "undefined") {
    return bodyHtml;
  }

  const dom = new DOMParser().parseFromString(`<main>${bodyHtml}</main>`, "text/html");
  const main = dom.body.querySelector("main");
  if (!main) {
    return bodyHtml;
  }

  for (const link of Array.from(main.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (link.getAttribute("href") !== `#${noteId}`) {
      continue;
    }

    link.parentNode?.insertBefore(dom.createTextNode(link.textContent ?? ""), link);
    link.parentNode?.removeChild(link);
  }

  return main.innerHTML;
}

function extractLinks(bodyHtml: string): FractalPageLink[] {
  if (typeof DOMParser === "undefined") {
    return [];
  }

  const dom = new DOMParser().parseFromString(bodyHtml, "text/html");

  return Array.from(dom.body.querySelectorAll<HTMLAnchorElement>("a[href]")).map((link) => {
    const href = link.getAttribute("href") ?? "";
    const text = (link.textContent ?? href).trim() || href;

    return {
      href,
      scope: link.getAttribute("data-fractal-link") ?? "body",
      text
    };
  });
}

function graphLinksForPage(project: StoredMockProject, page: StoredMockPage) {
  const pagePaths = new Set(project.pages.map((projectPage) => projectPage.path));
  const activeLinks = extractLinks(page.bodyHtml);
  const outlinks = activeLinks
    .map((link): FractalGraphPageLink | null => {
      const linkedPagePath = normalizeLinkHref(link.href);

      return linkedPagePath && pagePaths.has(linkedPagePath)
        ? {
            page: linkedPagePath,
            text: link.text
          }
        : null;
    })
    .filter((link): link is FractalGraphPageLink => Boolean(link));
  const backlinks = project.pages.flatMap((candidatePage) => {
    if (candidatePage.path === page.path) {
      return [];
    }

    return extractLinks(candidatePage.bodyHtml)
      .map((link): FractalGraphPageLink | null => {
        const linkedPagePath = normalizeLinkHref(link.href);

        return linkedPagePath === page.path
          ? {
              page: candidatePage.path,
              text: link.text
            }
          : null;
      })
      .filter((link): link is FractalGraphPageLink => Boolean(link));
  });

  return {
    backlinks,
    links: activeLinks,
    outlinks
  };
}

function projectSummary(project: StoredMockProject): FractalProjectSummary {
  return {
    directoryName: project.directoryName,
    name: project.name,
    rootPath: project.rootPath
  };
}

function toFractalProject(
  project: StoredMockProject,
  requestedPagePath?: string
): FractalProject {
  const sortedPages = sortPages(project.pages);
  const defaultPagePath = sortedPages.find((page) => page.path === "index.html")?.path;
  const activePagePath = requestedPagePath
    ? normalizePageReference(requestedPagePath)
    : defaultPagePath ?? sortedPages[0]?.path;
  const activePage = sortedPages.find((page) => page.path === activePagePath);

  if (!activePage) {
    throw new Error(`No HTML page named ${activePagePath} was found in ${project.rootPath}`);
  }

  for (const note of activePage.notes ?? []) {
    activePage.bodyHtml = linkNoteTriggerInBodyHtml(activePage.bodyHtml, note.label, note.id);
  }

  const graphLinks = graphLinksForPage(project, activePage);
  const pages: FractalPage[] = sortedPages.map((page) => ({
    bodyPreview: summaryFromBody(page.bodyHtml),
    name: page.title,
    path: page.path,
    summary: page.summary
  }));

  return {
    activePageBacklinks: graphLinks.backlinks,
    activePageBodyHtml: activePage.bodyHtml,
    activePageLinks: graphLinks.links,
    activePageNotes: activePage.notes ?? [],
    activePageOutlinks: graphLinks.outlinks,
    activePagePath: activePage.path,
    activePageSummary: activePage.summary,
    activePageTags: activePage.tags,
    activePageTitle: activePage.title,
    name: project.name,
    pages,
    rootPath: project.rootPath,
    theme: project.theme
  };
}

function seedState(): MockState {
  const directoryName = "field-notes";

  return {
    version: 1,
    projects: [
      {
        directoryName,
        name: "Field Notes Mock",
        rootPath: projectRoot(directoryName),
        theme: {
          "--project-accent": "#c9903f",
          "--project-background": "#181714",
          "--project-border": "#3c3931",
          "--project-muted": "#a89f91",
          "--project-surface": "#222018",
          "--project-text": "#f1eadc"
        },
        pages: [
          {
            bodyHtml:
              '<p>This browser-only project is a stable fixture for Playwright and visual debugging. It never touches disk, but it behaves like the Tauri Fractal adapter.</p><h2>What to inspect</h2><ul><li>Nested pages in the sidebar.</li><li>Rich text editing, dirty state, and save affordances.</li><li>Context metadata in the inspector.</li></ul><p>Continue with <a href="notes/day-one.html">day one notes</a> or review the <a href="archive/amber-console.html">amber console sketch</a>.</p>',
            notes: [
              {
                id: "mock-note-1",
                label: "Fixture",
                text: "Seed data from the browser mock client."
              }
            ],
            path: "index.html",
            summary:
              "A browser-only Fractal project for Playwright, visual QA, and editor interaction checks.",
            tags: ["mock", "playwright"],
            title: "Field Notes Mock"
          },
          {
            bodyHtml:
              '<p>The first note has enough text to exercise the document measure and inspector. Edit this content, save it, then navigate away and back to check state handling.</p><blockquote>Mock pages are deliberately localStorage-backed so debugging sessions can mutate them safely.</blockquote><p>Return to the <a href="index.html">project index</a>.</p>',
            notes: [
              {
                id: "day-one-observation",
                label: "Observation",
                text: "Longer prose is useful for editor spacing checks."
              }
            ],
            path: "notes/day-one.html",
            summary: "A nested page used to check file tree expansion and text editing flow.",
            tags: ["field", "draft"],
            title: "Day One"
          },
          {
            bodyHtml:
              '<p>An archived concept page for checking nested folders, backlinks, and the darker inspector panel against warm document chrome.</p><h3>Palette note</h3><p>Amber controls should feel functional rather than decorative. Back to <a href="index.html">index</a>.</p>',
            path: "archive/amber-console.html",
            summary: "A second nested page for sidebar and graph-link visual checks.",
            tags: ["archive", "style"],
            title: "Amber Console"
          }
        ]
      }
    ]
  };
}

function isMockState(value: unknown): value is MockState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const state = value as Partial<MockState>;

  return state.version === 1 && Array.isArray(state.projects);
}

function saveState(state: MockState) {
  memoryState = state;

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage can be unavailable in restricted browser contexts. The in-memory
    // copy is still enough for a Playwright session.
  }
}

function loadState() {
  if (memoryState) {
    return memoryState;
  }

  try {
    const rawState = window.localStorage.getItem(STORAGE_KEY);

    if (rawState) {
      const parsedState: unknown = JSON.parse(rawState);

      if (isMockState(parsedState)) {
        memoryState = parsedState;
        return parsedState;
      }
    }
  } catch {
    // Fall through to a clean seed when stored data is malformed or unavailable.
  }

  const state = seedState();
  saveState(state);
  return state;
}

function findProjectByDirectoryName(state: MockState, directoryName: string) {
  const project = state.projects.find((candidate) => candidate.directoryName === directoryName);

  if (!project) {
    throw new Error(`No mock Fractal project named ${directoryName} was found.`);
  }

  return project;
}

function findProjectByRoot(state: MockState, rootPath: string) {
  const project = state.projects.find((candidate) => candidate.rootPath === rootPath);

  if (!project) {
    throw new Error(`No mock Fractal project exists at ${rootPath}.`);
  }

  return project;
}

function createPageRecord(pagePath: string): StoredMockPage {
  const normalizedPath = normalizePageReference(pagePath);
  const title = titleFromPagePath(normalizedPath);

  return {
    bodyHtml: `<p>${escapeHtml(title)} is ready for notes.</p>`,
    path: normalizedPath,
    summary: null,
    tags: [],
    title
  };
}

export function createMockFractalClient(): FractalClient {
  return {
    async listProjects(): Promise<FractalProjectCatalog> {
      const state = loadState();

      return {
        projects: state.projects.map(projectSummary),
        rootPath: MOCK_ROOT_PATH
      };
    },

    async createProject(projectName: string): Promise<FractalProject> {
      const trimmedProjectName = projectName.trim();
      if (!trimmedProjectName) {
        throw new Error("Choose a project name before creating a project.");
      }

      const state = loadState();
      const directoryName = ensureUniqueDirectoryName(state.projects, trimmedProjectName);
      const project: StoredMockProject = {
        directoryName,
        name: trimmedProjectName,
        pages: [
          {
            bodyHtml: "<p>Fractal project scaffold from the browser mock.</p>",
            path: "index.html",
            summary: "Created in the browser mock; no local files were changed.",
            tags: ["mock"],
            title: trimmedProjectName
          }
        ],
        rootPath: projectRoot(directoryName)
      };

      state.projects.push(project);
      saveState(state);

      return toFractalProject(project, "index.html");
    },

    async openProject(directoryName: string): Promise<FractalProject> {
      const state = loadState();
      const project = findProjectByDirectoryName(state, directoryName);

      return toFractalProject(project);
    },

    async openPage(project: FractalProject, pagePath: string): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);

      return toFractalProject(storedProject, pagePath);
    },

    async savePage(project: FractalProject, update): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const activePagePath = normalizePageReference(project.activePagePath);
      const page = storedProject.pages.find((candidate) => candidate.path === activePagePath);

      if (!page) {
        throw new Error(`No HTML page named ${activePagePath} was found in ${project.rootPath}`);
      }

      page.bodyHtml = update.bodyHtml;
      page.summary = update.summary.trim() || null;
      page.tags = normalizeTags(update.tags);
      page.title = update.title.trim() || "Untitled";
      saveState(state);

      return toFractalProject(storedProject, activePagePath);
    },

    async createPage(project: FractalProject, pagePath: string): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const page = createPageRecord(pagePath);

      if (storedProject.pages.some((candidate) => candidate.path === page.path)) {
        throw new Error(`A mock page named ${page.path} already exists.`);
      }

      storedProject.pages.push(page);
      saveState(state);

      return toFractalProject(storedProject, page.path);
    },

    async renamePage(
      project: FractalProject,
      pagePath: string,
      nextPagePath: string
    ): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const currentPath = normalizePageReference(pagePath);
      const nextPath = normalizePageReference(nextPagePath);
      const page = storedProject.pages.find((candidate) => candidate.path === currentPath);

      if (!page) {
        throw new Error(`No mock page named ${currentPath} was found.`);
      }

      if (
        storedProject.pages.some(
          (candidate) => candidate.path === nextPath && candidate.path !== currentPath
        )
      ) {
        throw new Error(`A mock page named ${nextPath} already exists.`);
      }

      page.path = nextPath;
      saveState(state);

      const activePagePath =
        normalizePageReference(project.activePagePath) === currentPath
          ? nextPath
          : project.activePagePath;

      return toFractalProject(storedProject, activePagePath);
    },

    async deletePage(project: FractalProject, pagePath: string): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);

      if (storedProject.pages.length <= 1) {
        throw new Error("A Fractal project must keep at least one page.");
      }

      const deletedPagePath = normalizePageReference(pagePath);
      const nextPages = storedProject.pages.filter((page) => page.path !== deletedPagePath);

      if (nextPages.length === storedProject.pages.length) {
        throw new Error(`No mock page named ${deletedPagePath} was found.`);
      }

      storedProject.pages = nextPages;
      saveState(state);

      const activePagePath =
        normalizePageReference(project.activePagePath) === deletedPagePath
          ? sortPages(storedProject.pages)[0]?.path
          : project.activePagePath;

      return toFractalProject(storedProject, activePagePath);
    },

    async addNote(
      project: FractalProject,
      trigger: string,
      content: string
    ): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const activePagePath = normalizePageReference(project.activePagePath);
      const page = storedProject.pages.find((candidate) => candidate.path === activePagePath);

      if (!page) {
        throw new Error(`No mock page named ${activePagePath} was found.`);
      }

      const noteId = noteIdFromTrigger(trigger);
      const existingNotes = page.notes ?? [];
      if (existingNotes.some((note) => note.id === noteId)) {
        throw new Error(`A note for “${trigger}” already exists.`);
      }

      page.notes = [
        ...existingNotes,
        {
          id: noteId,
          label: trigger.trim(),
          text: content.trim()
        }
      ];
      page.bodyHtml = linkNoteTriggerInBodyHtml(page.bodyHtml, trigger, noteId);
      saveState(state);

      return toFractalProject(storedProject, activePagePath);
    },

    async updateNote(
      project: FractalProject,
      note: FractalNote,
      content: string
    ): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const activePagePath = normalizePageReference(project.activePagePath);
      const page = storedProject.pages.find((candidate) => candidate.path === activePagePath);

      if (!page) {
        throw new Error(`No mock page named ${activePagePath} was found.`);
      }

      const targetNote = (page.notes ?? []).find((candidate) => candidate.id === note.id);
      if (!targetNote) {
        throw new Error(`No mock note named ${note.label} was found.`);
      }

      targetNote.text = content.trim();
      saveState(state);

      return toFractalProject(storedProject, activePagePath);
    },

    async deleteNote(project: FractalProject, note: FractalNote): Promise<FractalProject> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);
      const activePagePath = normalizePageReference(project.activePagePath);
      const page = storedProject.pages.find((candidate) => candidate.path === activePagePath);

      if (!page) {
        throw new Error(`No mock page named ${activePagePath} was found.`);
      }

      const existingNotes = page.notes ?? [];
      if (!existingNotes.some((candidate) => candidate.id === note.id)) {
        throw new Error(`No mock note named ${note.label} was found.`);
      }

      page.notes = existingNotes.filter((candidate) => candidate.id !== note.id);
      page.bodyHtml = unlinkNoteInBodyHtml(page.bodyHtml, note.id);
      saveState(state);

      return toFractalProject(storedProject, activePagePath);
    },

    async validateProject(project: FractalProject): Promise<FractalCommandResult> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);

      return {
        details: `Mock validation checked ${storedProject.pages.length} HTML page(s).`,
        message: "Project validation completed.",
        ok: true
      };
    },

    async buildIndex(project: FractalProject): Promise<FractalCommandResult> {
      const state = loadState();
      const storedProject = findProjectByRoot(state, project.rootPath);

      return {
        details: `Mock index contains ${storedProject.pages.length} HTML page(s).`,
        message: "Project index built.",
        ok: true
      };
    }
  };
}
