import { recordDataflowEvent } from "@/lib/dataflowTelemetry";

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
  recordDataflowEvent({ documentId: key, name: "snapshot.controller", status: "success" });
  return () => {
    registered.delete(controller);
    if (!registered.size) controllers.delete(key);
    recordDataflowEvent({ documentId: key, name: "snapshot.controller", status: "superseded" });
  };
}

function currentController(documentId: string) {
  return Array.from(controllers.get(documentId) ?? [])
    .sort((left, right) => (right.getRevision?.() ?? -1) - (left.getRevision?.() ?? -1))[0];
}

function waitForController(documentId: string, timeoutMs = 1_000): Promise<EditorFlushController | null> {
  const deadline = performance.now() + timeoutMs;
  return new Promise((resolve) => {
    const check = () => {
      const controller = currentController(documentId);
      if (controller || performance.now() >= deadline) resolve(controller ?? null);
      else window.setTimeout(check, 16);
    };
    check();
  });
}

export function requestEditorSnapshot(documentId: string, minimumRevision = 0): Promise<EditorSnapshot | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  const pending = inFlight.get(documentId);
  if (pending && pending.minimumRevision >= minimumRevision) return pending.promise;
  const requestId = `editor-snapshot-${++requestSequence}`;
  const invoke = async (controller: EditorFlushController | null) => {
    if (!controller) {
      recordDataflowEvent({ documentId, name: "snapshot.controller-missing", revision: minimumRevision, status: "failure" });
      return null;
    }
    const snapshot = await controller.flush(minimumRevision, requestId);
    if (!snapshot) return null;
    if (snapshot.documentId !== documentId || snapshot.requestId !== requestId || snapshot.revision < minimumRevision) {
      throw new Error(`Snapshot ${requestId} returned obsolete document state.`);
    }
    return snapshot;
  };
  const controller = currentController(documentId);
  const promise = (controller ? invoke(controller) : waitForController(documentId).then(invoke)).finally(() => {
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
