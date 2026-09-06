const EDITOR_FLUSH_EVENT = "amanite:flush-editor";

export function requestEditorFlush(pagePath: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EDITOR_FLUSH_EVENT, { detail: { pagePath } }));
}

export function listenForEditorFlush(pagePath: string, flush: () => void) {
  const handleFlush = (event: Event) => {
    const detail = (event as CustomEvent<{ pagePath?: string }>).detail;
    if (detail?.pagePath === pagePath) flush();
  };
  window.addEventListener(EDITOR_FLUSH_EVENT, handleFlush);
  return () => window.removeEventListener(EDITOR_FLUSH_EVENT, handleFlush);
}
