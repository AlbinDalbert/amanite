type ResizeEvent = { preventDefault: () => void };

export function startPointerResize(
  event: ResizeEvent,
  element: HTMLElement,
  onMove: (event: globalThis.PointerEvent, bounds: DOMRect) => void
) {
  event.preventDefault();
  const move = (pointerEvent: globalThis.PointerEvent) => onMove(pointerEvent, element.getBoundingClientRect());
  const stop = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    window.removeEventListener("pointercancel", stop);
    document.body.classList.remove("resizing-panel");
  };
  document.body.classList.add("resizing-panel");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
  window.addEventListener("pointercancel", stop, { once: true });
}
