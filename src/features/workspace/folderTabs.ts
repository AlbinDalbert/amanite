export const FOLDER_TAB_PREFIX = "folder://";
export const PROJECT_OVERVIEW_TAB_ID = FOLDER_TAB_PREFIX;

export function folderTabId(path: string) {
  return `${FOLDER_TAB_PREFIX}${encodeURIComponent(path)}`;
}

export function folderPathFromTabId(tabId: string) {
  if (!tabId.startsWith(FOLDER_TAB_PREFIX)) return null;
  try {
    return decodeURIComponent(tabId.slice(FOLDER_TAB_PREFIX.length));
  } catch {
    return null;
  }
}

export function isFolderTab(tabId: string | null | undefined) {
  return Boolean(tabId && folderPathFromTabId(tabId) !== null);
}
