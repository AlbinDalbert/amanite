import { invoke } from "@tauri-apps/api/core";
import type { FractalPageDraft } from "@/lib/fractal/types";
import type { ReceiptMappings } from "@/lib/fractal/reconcile";
import { mapPagePath } from "@/lib/fractal/reconcile";

export type PageDraft = FractalPageDraft;
const LEGACY_PREFIX = "amanite.page-draft.v1:";
const generations = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();

function identity(projectRoot: string, pagePath: string) { return `${projectRoot}\u0000${pagePath}`; }
function hasTauriRuntime() { return "__TAURI_INTERNALS__" in window; }
function enqueue<T>(key: string, work: () => Promise<T>) {
  const next = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(work);
  queues.set(key, next);
  const cleanup = () => { if (queues.get(key) === next) queues.delete(key); };
  void next.then(cleanup, cleanup);
  return next;
}

export async function listPageDrafts(projectRoot?: string) {
  if (!hasTauriRuntime()) return [];
  return invoke<PageDraft[]>("fractal_list_drafts", { projectRoot });
}

export async function readPageDraft(projectRoot: string, pagePath: string) {
  if (!hasTauriRuntime()) return null;
  return invoke<PageDraft | null>("fractal_read_draft", { projectRoot, pagePath });
}

export function writePageDraftSource(projectRoot: string, pagePath: string, source: string, baseSourceHash: string) {
  const key = identity(projectRoot, pagePath);
  const generation = (generations.get(key) ?? 0) + 1;
  generations.set(key, generation);
  const draft: PageDraft = { version: 1, projectRoot, pagePath, source, baseSourceHash, updatedAt: new Date().toISOString() };
  if (!hasTauriRuntime()) return Promise.reject(new Error("Native draft storage requires the desktop app."));
  return enqueue(key, async () => {
    if (generations.get(key) !== generation) return;
    await invoke("fractal_write_draft", { draft });
  });
}

export function clearPageDraft(projectRoot: string, pagePath: string) {
  const key = identity(projectRoot, pagePath);
  if (!hasTauriRuntime()) return Promise.resolve();
  return enqueue(key, () => invoke("fractal_delete_draft", { projectRoot, pagePath }));
}

export function movePageDraft(projectRoot: string, from: string, to: string) {
  if (!hasTauriRuntime()) return Promise.resolve();
  return invoke("fractal_move_draft", { projectRoot, from, to });
}

export async function reconcilePageDrafts(projectRoot: string, mappings: ReceiptMappings) {
  const drafts = await listPageDrafts(projectRoot);
  for (const draft of drafts) {
    if (mappings.deletedPages.has(draft.pagePath) || Array.from(mappings.deletedFolders).some((folder) => draft.pagePath.startsWith(`${folder}/`))) {
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
      if (value.version !== 1 || !value.projectRoot || !value.pagePath || typeof value.source !== "string") continue;
      await invoke("fractal_write_draft", { draft: { ...value, baseSourceHash: value.baseSourceHash ?? "", updatedAt: value.updatedAt ?? new Date().toISOString() } });
      localStorage.removeItem(key);
    } catch { /* Keep malformed or unwritten legacy drafts. */ }
  }
}
