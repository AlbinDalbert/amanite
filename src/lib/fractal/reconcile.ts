import type { FractalMutationReceipt, FractalProjectChange } from "./types";

export function pagePathFromProjectPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  return normalized.startsWith("pages/") && normalized.endsWith(".fractal.html")
    ? normalized.slice("pages/".length)
    : null;
}

export function folderPathFromProjectPath(path: string) {
  const normalized = path.replace(/^\/+/, "");
  if (!normalized.startsWith("pages/")) return null;
  const folder = normalized.slice("pages/".length).replace(/\/\.fractal-folder\.json$/, "");
  return folder === ".fractal-folder.json" ? "" : folder;
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

export type ReceiptMappings = { pages: Map<string, string>; folders: Map<string, string>; deletedPages: Set<string>; deletedFolders: Set<string>; rewrittenPages: Set<string> };

export function receiptMappings(receipt: FractalMutationReceipt): ReceiptMappings {
  const result: ReceiptMappings = { pages: new Map(), folders: new Map(), deletedPages: new Set(), deletedFolders: new Set(), rewrittenPages: new Set() };
  for (const change of receipt.changes) applyChange(result, change);
  return result;
}

function applyChange(result: ReceiptMappings, change: FractalProjectChange) {
  if (change.change === "updated") {
    const page = pagePathFromProjectPath(change.path);
    if (page) result.rewrittenPages.add(page);
    return;
  }
  if (change.change === "moved") {
    if (change.entry === "file") {
      const from = pagePathFromProjectPath(change.from);
      const to = pagePathFromProjectPath(change.to);
      if (from && to) result.pages.set(from, to);
    } else {
      const from = folderPathFromProjectPath(change.from);
      const to = folderPathFromProjectPath(change.to);
      if (from != null && to != null) result.folders.set(from, to);
    }
    return;
  }
  if (change.change !== "deleted") return;
  if (change.entry === "file") {
    const page = pagePathFromProjectPath(change.path);
    if (page) result.deletedPages.add(page);
  } else {
    const folder = folderPathFromProjectPath(change.path);
    if (folder != null) result.deletedFolders.add(folder);
  }
}

export function mapPagePath(path: string, mappings: ReceiptMappings) {
  const direct = mappings.pages.get(path);
  if (direct) return direct;
  for (const [from, to] of mappings.folders) {
    if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  }
  return path;
}
