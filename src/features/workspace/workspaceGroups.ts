export type EditorGroupId = "left" | "right";

export type EditorGroup = {
  id: EditorGroupId;
  tabs: string[];
  activePath: string | null;
  history: string[];
  historyIndex: number;
};

export type WorkspaceGroups = {
  activeGroupId: EditorGroupId;
  left: EditorGroup;
  right: EditorGroup | null;
};

function createGroup(id: EditorGroupId, path?: string | null): EditorGroup {
  const tabs = path ? [path] : [];
  return { id, tabs, activePath: path ?? null, history: tabs, historyIndex: tabs.length - 1 };
}

export function createWorkspaceGroups(path?: string | null): WorkspaceGroups {
  return { activeGroupId: "left", left: createGroup("left", path), right: null };
}

function withHistory(group: EditorGroup, path: string): EditorGroup {
  if (group.history[group.historyIndex] === path) return { ...group, activePath: path };
  const history = [...group.history.slice(0, group.historyIndex + 1), path];
  return { ...group, activePath: path, history, historyIndex: history.length - 1 };
}

function updateGroup(state: WorkspaceGroups, id: EditorGroupId, group: EditorGroup | null): WorkspaceGroups {
  return id === "left" ? { ...state, left: group ?? createGroup("left") } : { ...state, right: group };
}

export function activateGroup(state: WorkspaceGroups, id: EditorGroupId): WorkspaceGroups {
  if (id === "right" && !state.right) return state;
  return state.activeGroupId === id ? state : { ...state, activeGroupId: id };
}

export function openGroupTab(state: WorkspaceGroups, id: EditorGroupId, path: string): WorkspaceGroups {
  const current = id === "left" ? state.left : state.right ?? createGroup("right");
  const tabs = current.tabs.includes(path) ? current.tabs : [...current.tabs, path];
  const next = withHistory({ ...current, tabs }, path);
  return { ...updateGroup(state, id, next), activeGroupId: id };
}

function activeAfterRemoval(group: EditorGroup, path: string, tabs: string[]) {
  if (group.activePath !== path) return group.activePath;
  const removedIndex = group.tabs.indexOf(path);
  return tabs[Math.min(Math.max(removedIndex, 0), tabs.length - 1)] ?? tabs.at(-1) ?? null;
}

function withoutTab(group: EditorGroup, path: string): EditorGroup {
  const tabs = group.tabs.filter((candidate) => candidate !== path);
  const activePath = activeAfterRemoval(group, path, tabs);
  const history = group.history.filter((candidate) => candidate !== path);
  const historyIndex = activePath ? Math.max(0, history.lastIndexOf(activePath)) : -1;
  return { ...group, tabs, activePath, history, historyIndex };
}

export function closeGroupTab(state: WorkspaceGroups, id: EditorGroupId, path: string): WorkspaceGroups {
  const group = id === "left" ? state.left : state.right;
  if (!group?.tabs.includes(path)) return state;
  const next = withoutTab(group, path);

  if (id === "right" && !next.tabs.length) {
    return { ...state, activeGroupId: "left", right: null };
  }
  if (id === "left" && !next.tabs.length && state.right) {
    return {
      activeGroupId: "left",
      left: { ...state.right, id: "left" },
      right: null
    };
  }
  return updateGroup({ ...state, activeGroupId: id }, id, next);
}

function insertAt(tabs: string[], path: string, index?: number) {
  const without = tabs.filter((candidate) => candidate !== path);
  const insertion = index == null ? without.length : Math.max(0, Math.min(index, without.length));
  return [...without.slice(0, insertion), path, ...without.slice(insertion)];
}

export function moveGroupTab(
  state: WorkspaceGroups,
  sourceId: EditorGroupId,
  targetId: EditorGroupId,
  path: string,
  targetIndex?: number
): WorkspaceGroups {
  const source = sourceId === "left" ? state.left : state.right;
  if (!source?.tabs.includes(path)) return state;

  if (sourceId === targetId) {
    const tabs = insertAt(source.tabs, path, targetIndex);
    return updateGroup({ ...state, activeGroupId: targetId }, targetId, { ...source, tabs, activePath: path });
  }

  const target = targetId === "left" ? state.left : state.right ?? createGroup("right");
  const nextTarget = withHistory({ ...target, tabs: insertAt(target.tabs, path, targetIndex) }, path);
  const keepOnlyLeftTab = sourceId === "left" && source.tabs.length === 1;
  const nextSource = keepOnlyLeftTab ? source : withoutTab(source, path);
  let next = updateGroup(state, sourceId, nextSource.tabs.length ? nextSource : null);
  next = updateGroup(next, targetId, nextTarget);
  return { ...next, activeGroupId: targetId };
}

export function navigateGroupHistory(state: WorkspaceGroups, id: EditorGroupId, direction: -1 | 1): WorkspaceGroups {
  const group = id === "left" ? state.left : state.right;
  if (!group) return state;
  const historyIndex = group.historyIndex + direction;
  const activePath = group.history[historyIndex];
  if (!activePath) return state;
  return updateGroup({ ...state, activeGroupId: id }, id, { ...group, activePath, historyIndex });
}

export function reconcileWorkspaceGroups(state: WorkspaceGroups, validPaths: Set<string>): WorkspaceGroups {
  const clean = (group: EditorGroup) => {
    const tabs = group.tabs.filter((path) => validPaths.has(path));
    const activePath = group.activePath && validPaths.has(group.activePath) ? group.activePath : tabs[0] ?? null;
    const history = group.history.filter((path) => validPaths.has(path));
    const historyIndex = activePath ? Math.max(0, history.lastIndexOf(activePath)) : -1;
    return { ...group, tabs, activePath, history, historyIndex };
  };
  const left = clean(state.left);
  const right = state.right ? clean(state.right) : null;
  if (!left.tabs.length && right?.tabs.length) {
    return { activeGroupId: "left", left: { ...right, id: "left" }, right: null };
  }
  return {
    activeGroupId: state.activeGroupId === "right" && !right?.tabs.length ? "left" : state.activeGroupId,
    left,
    right: right?.tabs.length ? right : null
  };
}

export function renameGroupTab(state: WorkspaceGroups, from: string, to: string): WorkspaceGroups {
  const rename = (group: EditorGroup): EditorGroup => ({
    ...group,
    tabs: group.tabs.map((path) => path === from ? to : path),
    activePath: group.activePath === from ? to : group.activePath,
    history: group.history.map((path) => path === from ? to : path)
  });
  return { ...state, left: rename(state.left), right: state.right ? rename(state.right) : null };
}

export function groupForPath(state: WorkspaceGroups, path: string) {
  if (state.left.tabs.includes(path)) return "left" as const;
  if (state.right?.tabs.includes(path)) return "right" as const;
  return null;
}

export function tabPathForShortcut(group: EditorGroup, key: string) {
  if (!/^\d$/.test(key)) return null;
  const position = key === "0" ? 10 : Number(key);
  return group.tabs[position - 1] ?? null;
}

export function tabPathForDirection(group: EditorGroup, direction: -1 | 1) {
  if (group.tabs.length < 2 || !group.activePath) return null;
  const activeIndex = group.tabs.indexOf(group.activePath);
  if (activeIndex < 0) return null;
  const nextIndex = (activeIndex + direction + group.tabs.length) % group.tabs.length;
  return group.tabs[nextIndex] ?? null;
}
