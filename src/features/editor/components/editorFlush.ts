export type EditorSnapshot = {
  bodyHtml: string;
  documentId: string;
  incarnation: number;
  projectGeneration: number;
  requestId: string;
  revision: number;
};

export type EditorFlushController = {
  documentId?: string;
  incarnation?: number;
  projectGeneration?: number;
  flush: (minimumRevision?: number, requestId?: string) => EditorSnapshot | void | Promise<EditorSnapshot | void>;
  getRevision?: () => number;
};

const controllers = new Map<string, Set<EditorFlushController>>();
const inFlight = new Map<string, { minimumRevision: number; promise: Promise<EditorSnapshot | null> }>();
let requestSequence = 0;

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
  const pending = inFlight.get(documentId);
  if (pending && pending.minimumRevision >= minimumRevision) return pending.promise;
  const controller = Array.from(controllers.get(documentId) ?? [])
    .sort((left, right) => (right.getRevision?.() ?? -1) - (left.getRevision?.() ?? -1))[0];
  if (!controller) return Promise.resolve(null);
  const requestId = `editor-snapshot-${++requestSequence}`;
  const promise = Promise.resolve(controller.flush(minimumRevision, requestId)).then((snapshot) => {
    if (!snapshot) return null;
    if (snapshot.documentId !== documentId || snapshot.requestId !== requestId || snapshot.revision < minimumRevision) {
      throw new Error(`Snapshot ${requestId} returned obsolete document state.`);
    }
    return snapshot;
  }).finally(() => {
    if (inFlight.get(documentId)?.promise === promise) inFlight.delete(documentId);
  });
  inFlight.set(documentId, { minimumRevision, promise });
  return promise;
}

export function requestEditorFlush(documentId: string, minimumRevision = 0) {
  return requestEditorSnapshot(documentId, minimumRevision).then(() => undefined);
}

export function settleEditorComposition(root: HTMLElement | null, timeoutMs = 1_000) {
  if (!root || !root.closest("[contenteditable='true']") && root.getAttribute("contenteditable") !== "true") return Promise.resolve();
  const editor = root;
  if (!editor.matches(":focus") || !editor.ownerDocument.defaultView) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      editor.removeEventListener("compositionend", complete);
      reject(new Error("The editor composition did not finish before the close barrier timed out."));
    }, timeoutMs);
    const complete = () => {
      window.clearTimeout(timeout);
      resolve();
    };
    editor.addEventListener("compositionend", complete, { once: true });
    window.queueMicrotask(() => {
      if (!editor.matches(":focus")) complete();
    });
  });
}
