import type { FractalProject } from "@/lib/fractal/types";

type PageDraft = {
  pagePath: string;
  projectRoot: string;
  source: string;
  updatedAt: string;
  version: 1;
};

const DRAFT_PREFIX = "amanite.page-draft.v1:";

function draftKey(projectRoot: string, pagePath: string) {
  return `${DRAFT_PREFIX}${encodeURIComponent(`${projectRoot}\u0000${pagePath}`)}`;
}

export function readPageDraft(projectRoot: string, pagePath: string) {
  try {
    const stored = localStorage.getItem(draftKey(projectRoot, pagePath));
    if (!stored) return null;
    const draft = JSON.parse(stored) as Partial<PageDraft>;
    if (
      draft.version !== 1 ||
      draft.projectRoot !== projectRoot ||
      draft.pagePath !== pagePath ||
      typeof draft.source !== "string" ||
      typeof draft.updatedAt !== "string"
    ) {
      return null;
    }
    return draft as PageDraft;
  } catch {
    return null;
  }
}

export function writePageDraft(project: FractalProject) {
  if (!project.activePagePath || project.activePageSource == null) return;
  writePageDraftSource(project.rootPath, project.activePagePath, project.activePageSource);
}

export function writePageDraftSource(projectRoot: string, pagePath: string, source: string) {
  const draft: PageDraft = {
    pagePath,
    projectRoot,
    source,
    updatedAt: new Date().toISOString(),
    version: 1
  };
  try {
    localStorage.setItem(draftKey(draft.projectRoot, draft.pagePath), JSON.stringify(draft));
  } catch {
    // Draft recovery is best-effort when storage is unavailable or full.
  }
}

export function clearPageDraft(projectRoot: string, pagePath: string) {
  try {
    localStorage.removeItem(draftKey(projectRoot, pagePath));
  } catch {
    // Storage may be unavailable in a hardened webview.
  }
}
