export const NOTE_CONTEXT_MENU_WIDTH = 208;
export const NOTE_CONTEXT_MENU_HEIGHT = 96;
export const NOTE_POPOVER_WIDTH = 318;
export const NOTE_PREVIEW_POPOVER_HEIGHT = 148;
export const NOTE_DETAIL_POPOVER_HEIGHT = 242;
export const NOTE_EDITOR_POPOVER_HEIGHT = 238;

export function positionFloatingPopover(
  rect: Pick<DOMRect, "bottom" | "height" | "left" | "top" | "width">,
  height: number
) {
  const x = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - NOTE_POPOVER_WIDTH / 2,
      window.innerWidth - NOTE_POPOVER_WIDTH - 8
    )
  );
  const preferredY = rect.bottom + 10;
  const y =
    preferredY + height <= window.innerHeight - 8
      ? preferredY
      : Math.max(8, rect.top - height - 10);

  return { x, y };
}

export function positionFloatingPoint(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8))
  };
}

export function selectionAnchorRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = Array.from(range.getClientRects()).find(
    (clientRect) => clientRect.width > 0 || clientRect.height > 0
  );

  if (rect) {
    return rect;
  }

  const fallbackRect = range.getBoundingClientRect();
  return fallbackRect.width > 0 || fallbackRect.height > 0 ? fallbackRect : null;
}
