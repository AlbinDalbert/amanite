import type {
  FractalFolder,
  FractalMutationBatchResult,
  FractalMutationReceipt,
  FractalMutationResult,
  FractalPage,
  FractalProject,
  FractalProjectChange
} from "./types";

export function pagePathFromProjectPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return normalized.startsWith("pages/") && normalized.endsWith(".fractal.html")
    ? normalized.slice("pages/".length)
    : null;
}

export function folderPathFromProjectPath(path: string, entry?: "file" | "directory") {
  const normalized = path.replace(/^\/+/, "");
  if (!normalized.startsWith("pages/")) return null;
  const relative = normalized.slice("pages/".length);
  if (relative === ".fractal-folder.json") return "";
  if (relative.endsWith("/.fractal-folder.json")) return relative.slice(0, -"/.fractal-folder.json".length);
  return entry === "directory" ? relative : null;
}

export function createdPagePath(receipt: FractalMutationReceipt) {
  for (const change of receipt.changes) {
    if (change.change === "created" && change.entry === "file") {
      const path = pagePathFromProjectPath(change.path);
      if (path) return path;
    }
  }
  return null;
}

export type ReceiptMappings = {
  pages: Map<string, string>;
  folders: Map<string, string>;
  createdPages: Set<string>;
  createdFolders: Set<string>;
  deletedPages: Set<string>;
  deletedFolders: Set<string>;
  rewrittenPages: Set<string>;
  rewrittenFolders: Set<string>;
};

export function receiptMappings(receipt: FractalMutationReceipt): ReceiptMappings {
  const result: ReceiptMappings = {
    pages: new Map(),
    folders: new Map(),
    createdPages: new Set(),
    createdFolders: new Set(),
    deletedPages: new Set(),
    deletedFolders: new Set(),
    rewrittenPages: new Set(),
    rewrittenFolders: new Set()
  };
  for (const change of receipt.changes) applyChange(result, change);
  return result;
}

function applyChange(result: ReceiptMappings, change: FractalProjectChange) {
  if (change.change === "created") {
    if (change.entry === "file") {
      const page = pagePathFromProjectPath(change.path);
      if (page) {
        result.createdPages.add(page);
        return;
      }
    }
    const folder = folderPathFromProjectPath(change.path, change.entry);
    if (folder != null) result.createdFolders.add(folder);
    return;
  }
  if (change.change === "updated") {
    const page = pagePathFromProjectPath(change.path);
    if (page) result.rewrittenPages.add(page);
    else {
      const folder = folderPathFromProjectPath(change.path);
      if (folder != null) result.rewrittenFolders.add(folder);
    }
    return;
  }
  if (change.change === "moved") {
    if (change.entry === "file") {
      const from = pagePathFromProjectPath(change.from);
      const to = pagePathFromProjectPath(change.to);
      if (from && to) result.pages.set(from, to);
    } else {
      const from = folderPathFromProjectPath(change.from, change.entry);
      const to = folderPathFromProjectPath(change.to, change.entry);
      if (from != null && to != null) result.folders.set(from, to);
    }
    return;
  }
  if (change.change !== "deleted") return;
  if (change.entry === "file") {
    const page = pagePathFromProjectPath(change.path);
    if (page) result.deletedPages.add(page);
  } else {
    const folder = folderPathFromProjectPath(change.path, change.entry);
    if (folder != null) result.deletedFolders.add(folder);
  }
}

function mapPath(path: string, directMappings: Map<string, string>, folderMappings: Map<string, string>) {
  let current = path;
  const seen = new Set<string>();
  while (!seen.has(current)) {
    seen.add(current);
    const direct = directMappings.get(current);
    if (direct) {
      current = direct;
      continue;
    }
    const mapped = mapFolderPrefix(current, folderMappings);
    if (mapped === current) break;
    current = mapped;
  }
  return current;
}

function mapFolderPathWithMappings(path: string, mappings: Map<string, string>) {
  let match: [string, string] | null = null;
  for (const [from, to] of mappings) {
    if (path !== from && !path.startsWith(`${from}/`)) continue;
    if (!match || from.length > match[0].length) match = [from, to];
  }
  if (!match) return path;
  return `${match[1]}${path.slice(match[0].length)}`;
}

function mapFolderPrefix(path: string, mappings: Map<string, string>) {
  return mapFolderPathWithMappings(path, mappings);
}

export function mapFolderPath(path: string, mappings: ReceiptMappings) {
  return mapPath(path, new Map(), mappings.folders);
}

export function mapPagePath(path: string, mappings: ReceiptMappings) {
  return mapPath(path, mappings.pages, mappings.folders);
}

export type MutationScope = {
  mappings: ReceiptMappings;
  affectedPages: Set<string>;
  affectedFolders: Set<string>;
  hasPagePathChanges: boolean;
  hasFolderPathChanges: boolean;
  hasDocumentRewrites: boolean;
  requiresConservativeBarrier: boolean;
};

function scopeForReceipts(receipts: readonly FractalMutationReceipt[]): MutationScope {
  const mappings: ReceiptMappings = {
    pages: new Map(),
    folders: new Map(),
    createdPages: new Set(),
    createdFolders: new Set(),
    deletedPages: new Set(),
    deletedFolders: new Set(),
    rewrittenPages: new Set(),
    rewrittenFolders: new Set()
  };
  let requiresConservativeBarrier = false;
  for (const receipt of receipts) {
    const next = receiptMappings(receipt);
    for (const [from, to] of next.pages) mappings.pages.set(from, to);
    for (const [from, to] of next.folders) mappings.folders.set(from, to);
    for (const path of next.createdPages) mappings.createdPages.add(path);
    for (const path of next.createdFolders) mappings.createdFolders.add(path);
    for (const path of next.deletedPages) mappings.deletedPages.add(path);
    for (const path of next.deletedFolders) mappings.deletedFolders.add(path);
    for (const path of next.rewrittenPages) mappings.rewrittenPages.add(path);
    for (const path of next.rewrittenFolders) mappings.rewrittenFolders.add(path);
    requiresConservativeBarrier ||= receipt.changes.some((change) => change.change === "moved" && change.entry === "directory");
  }

  const affectedPages = new Set([
    ...mappings.createdPages,
    ...mappings.deletedPages,
    ...mappings.rewrittenPages,
    ...mappings.pages.keys(),
    ...mappings.pages.values()
  ]);
  const affectedFolders = new Set([
    ...mappings.createdFolders,
    ...mappings.deletedFolders,
    ...mappings.rewrittenFolders,
    ...mappings.folders.keys(),
    ...mappings.folders.values()
  ]);
  return {
    mappings,
    affectedPages,
    affectedFolders,
    hasPagePathChanges: mappings.pages.size > 0,
    hasFolderPathChanges: mappings.folders.size > 0,
    hasDocumentRewrites: mappings.rewrittenPages.size > 0 || mappings.folders.size > 0,
    requiresConservativeBarrier
  };
}

export function mutationScope(receipt: FractalMutationReceipt): MutationScope;
export function mutationScope(receipts: readonly FractalMutationReceipt[]): MutationScope;
export function mutationScope(input: FractalMutationReceipt | readonly FractalMutationReceipt[]) {
  return scopeForReceipts(Array.isArray(input) ? input : [input]);
}

function samePage(left: FractalPage, right: FractalPage) {
  return left.path === right.path
    && left.contentHash === right.contentHash
    && left.title === right.title;
}

function sameFolder(left: FractalFolder, right: FractalFolder) {
  return left.path === right.path
    && left.title === right.title
    && JSON.stringify(left.order) === JSON.stringify(right.order)
    && JSON.stringify(left.children) === JSON.stringify(right.children)
    && JSON.stringify(left.issues) === JSON.stringify(right.issues);
}

export function reconcileProjectSnapshot(current: FractalProject, next: FractalProject): FractalProject {
  const currentPages = new Map(current.pages.map((page) => [page.path, page]));
  const currentFolders = new Map(current.folders.map((folder) => [folder.path, folder]));
  return {
    ...next,
    pages: next.pages.map((page) => {
      const previous = currentPages.get(page.path);
      return previous && samePage(previous, page) ? previous : page;
    }),
    folders: next.folders.map((folder) => {
      const previous = currentFolders.get(folder.path);
      return previous && sameFolder(previous, folder) ? previous : folder;
    })
  };
}

export function applyProjectUpdate(current: FractalProject, update: FractalProject, receipts: readonly FractalMutationReceipt[]): FractalProject {
  const scope = mutationScope(receipts);
  const pages = new Map<string, FractalPage>();
  for (const page of current.pages) {
    if (scope.mappings.deletedPages.has(page.path)) continue;
    const path = mapPagePath(page.path, scope.mappings);
    if (Array.from(scope.mappings.deletedFolders).some((folder) => page.path === folder || page.path.startsWith(`${folder}/`))) continue;
    pages.set(path, path === page.path ? page : { ...page, path });
  }
  for (const page of update.pages) pages.set(page.path, page);

  const folders = new Map<string, FractalFolder>();
  for (const folder of current.folders) {
    if (scope.mappings.deletedFolders.has(folder.path)) continue;
    const path = mapFolderPath(folder.path, scope.mappings);
    folders.set(path, path === folder.path ? folder : { ...folder, path });
  }
  for (const folder of update.folders) folders.set(folder.path, folder);

  return reconcileProjectSnapshot(current, {
    ...current,
    ...update,
    pages: Array.from(pages.values()).sort((left, right) => left.path.localeCompare(right.path)),
    folders: Array.from(folders.values()).sort((left, right) => left.path.localeCompare(right.path))
  });
}

export type ReconciledMutation = {
  result: FractalMutationResult;
  scope: MutationScope;
};

export function reconcileMutationResult(current: FractalProject, result: FractalMutationResult): ReconciledMutation {
  return {
    result: { ...result, project: reconcileProjectSnapshot(current, result.project) },
    scope: mutationScope(result.receipt)
  };
}

export type ReconciledMutationBatch = {
  result: FractalMutationBatchResult;
  scope: MutationScope;
};

export function reconcileMutationBatch(current: FractalProject, result: FractalMutationBatchResult): ReconciledMutationBatch {
  return {
    result: { ...result, project: reconcileProjectSnapshot(current, result.project) },
    scope: mutationScope(result.receipts)
  };
}
