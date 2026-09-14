const EDITOR_FLUSH_EVENT = "amanite:flush-editor";

export type EditorFlushController = {
  flush: () => void | Promise<void>;
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

export function requestEditorFlush(pagePath: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EDITOR_FLUSH_EVENT, { detail: { pagePath } }));
  const pending = Array.from(controllers.get(pagePath) ?? [], (controller) => controller.flush());
  return Promise.all(pending).then(() => undefined);
}

export function listenForEditorFlush(pagePath: string, flush: () => void) {
  const handleFlush = (event: Event) => {
    const detail = (event as CustomEvent<{ pagePath?: string }>).detail;
    if (detail?.pagePath === pagePath) flush();
  };
  window.addEventListener(EDITOR_FLUSH_EVENT, handleFlush);
  return () => window.removeEventListener(EDITOR_FLUSH_EVENT, handleFlush);
}
