import { invoke } from "@tauri-apps/api/core";
import type { FractalPageDraft } from "@/lib/fractal/types";
import { mapPagePath, type ReceiptMappings } from "@/lib/fractal/reconcile";

export type PageDraft = FractalPageDraft;

const LEGACY_PREFIX = "amanite.page-draft.v1:";
const generations = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

function identity(projectRoot: string, pagePath: string) {
  return `${projectRoot}\u0000${pagePath}`;
}

function projectQueueKey(projectRoot: string) {
  return `project\u0000${projectRoot}`;
}

function enqueue<T>(key: string, work: () => Promise<T>) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(key, next);
  const cleanup = () => {
    if (queues.get(key) === next) queues.delete(key);
  };
  void next.then(cleanup, cleanup);
  return next;
}

function enqueueProject<T>(projectRoot: string, work: () => Promise<T>) {
  return enqueue(projectQueueKey(projectRoot), work);
}

function invalidate(projectRoot: string, pagePath: string) {
  const key = identity(projectRoot, pagePath);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  return { generation, key };
}

export async function listPageDrafts(projectRoot?: string) {
  if (!hasTauriRuntime()) return [];
  return invoke<PageDraft[]>("fractal_list_drafts", { projectRoot });
}

export async function readPageDraft(projectRoot: string, pagePath: string) {
  if (!hasTauriRuntime()) return null;
  return invoke<PageDraft | null>("fractal_read_draft", { projectRoot, pagePath });
}

export type PageDraftWriteResult = { revision: number; status: "written" | "superseded" };

export function writePageDraftSource(projectRoot: string, pagePath: string, source: string, baseSourceHash: string, revision: number) {
  const { generation, key } = invalidate(projectRoot, pagePath);
  const draft: PageDraft = {
    version: 1,
    projectRoot,
    pagePath,
    source,
    baseSourceHash,
    updatedAt: new Date().toISOString(),
    revision
  };
  if (!hasTauriRuntime()) return Promise.reject(new Error("Native draft storage requires the desktop app."));
  return enqueueProject(projectRoot, async (): Promise<PageDraftWriteResult> => {
    if (generations.get(key) !== generation) return { revision, status: "superseded" };
    await invoke("fractal_write_draft", { draft });
    return { revision, status: "written" };
  });
}

export function clearPageDraft(projectRoot: string, pagePath: string) {
  invalidate(projectRoot, pagePath);
  if (!hasTauriRuntime()) return Promise.resolve();
  return enqueueProject(projectRoot, () => invoke("fractal_delete_draft", { projectRoot, pagePath }));
}

async function movePageDraft(projectRoot: string, from: string, to: string) {
  if (!hasTauriRuntime()) return;
  invalidate(projectRoot, from);
  invalidate(projectRoot, to);
  await enqueueProject(projectRoot, () => invoke("fractal_move_draft", { projectRoot, from, to }));
}

export async function reconcilePageDrafts(projectRoot: string, mappings: ReceiptMappings) {
  const drafts = await listPageDrafts(projectRoot);
  for (const draft of drafts) {
    const insideDeletedFolder = Array.from(mappings.deletedFolders)
      .some((folder) => draft.pagePath.startsWith(`${folder}/`));
    if (mappings.deletedPages.has(draft.pagePath) || insideDeletedFolder) {
      await clearPageDraft(projectRoot, draft.pagePath);
      continue;
    }
    const next = mapPagePath(draft.pagePath, mappings);
    if (next !== draft.pagePath) await movePageDraft(projectRoot, draft.pagePath, next);
  }
}

export async function migrateLegacyDrafts() {
  if (!hasTauriRuntime()) return;
  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
    .filter((key): key is string => Boolean(key?.startsWith(LEGACY_PREFIX)));

  for (const key of keys) {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<PageDraft>;
      const valid = value.version === 1
        && Boolean(value.projectRoot)
        && Boolean(value.pagePath)
        && typeof value.source === "string";
      if (!valid) continue;
      await invoke("fractal_write_draft", {
        draft: {
          ...value,
          baseSourceHash: value.baseSourceHash ?? "",
          updatedAt: value.updatedAt ?? new Date().toISOString(),
          revision: value.revision ?? 0
        }
      });
      localStorage.removeItem(key);
    } catch {
      // Keep malformed or unwritten legacy drafts.
    }
  }
}
