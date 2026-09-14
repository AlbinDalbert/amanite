export type EditorSnapshot = {
  bodyHtml: string;
  revision: number;
};

export type EditorFlushController = {
  flush: (minimumRevision?: number) => void | Promise<EditorSnapshot | void>;
  getRevision?: () => number;
};

const controllers = new Map<string, Set<EditorFlushController>>();

export function registerEditorFlush(key: string, controller: EditorFlushController) {
  const registered = controllers.get(key) ?? new Set<EditorFlushController>();
  registered.add(controller);
  controllers.set(key, registered);
  return () => {
    registered.delete(controller);
    if (!registered.size) controllers.delete(key);
  };
}

export function requestEditorSnapshot(documentId: string, minimumRevision = 0): Promise<EditorSnapshot | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const pending = Array.from(controllers.get(documentId) ?? [], (controller) => controller.flush(minimumRevision));
  return Promise.all(pending).then((snapshots) => snapshots.find((snapshot): snapshot is EditorSnapshot => Boolean(snapshot)) ?? null);
}

export function requestEditorFlush(documentId: string, minimumRevision = 0) {
  return requestEditorSnapshot(documentId, minimumRevision).then(() => undefined);
}
