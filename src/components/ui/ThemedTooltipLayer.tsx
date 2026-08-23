import { useEffect, useRef, useState } from "react";

type Tooltip = { text: string; left: number; top: number };

function ThemedTooltipLayer() {
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const activeRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const clear = () => {
      if (timerRef.current != null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      setTooltip(null);
    };
    const restore = () => {
      const active = activeRef.current;
      if (active?.dataset.amaniteTooltip) active.title = active.dataset.amaniteTooltip;
      active?.removeAttribute("data-amanite-tooltip");
      activeRef.current = null;
    };
    const show = (element: HTMLElement, immediate: boolean) => {
      clear();
      if (activeRef.current !== element) restore();
      const text = element.title || element.dataset.amaniteTooltip;
      if (!text) return;
      activeRef.current = element;
      element.dataset.amaniteTooltip = text;
      element.removeAttribute("title");
      if (!element.hasAttribute("aria-label") && !element.textContent?.trim()) element.setAttribute("aria-label", text);
      const reveal = () => {
        const bounds = element.getBoundingClientRect();
        setTooltip({ text, left: Math.min(window.innerWidth - 14, Math.max(14, bounds.left + bounds.width / 2)), top: bounds.bottom + 9 });
      };
      if (immediate) reveal(); else timerRef.current = window.setTimeout(reveal, 320);
    };
    const targetFrom = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>("[title], [data-amanite-tooltip]") : null;
    const over = (event: PointerEvent) => { const target = targetFrom(event.target); if (target) show(target, false); };
    const out = (event: PointerEvent) => {
      if (!activeRef.current || event.relatedTarget instanceof Node && activeRef.current.contains(event.relatedTarget)) return;
      clear(); restore();
    };
    const focus = (event: FocusEvent) => { const target = targetFrom(event.target); if (target) show(target, true); };
    const blur = () => { clear(); restore(); };
    document.addEventListener("pointerover", over);
    document.addEventListener("pointerout", out);
    document.addEventListener("focusin", focus);
    document.addEventListener("focusout", blur);
    return () => {
      clear(); restore();
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerout", out);
      document.removeEventListener("focusin", focus);
      document.removeEventListener("focusout", blur);
    };
  }, []);

  return tooltip ? <div className="themed-tooltip" role="tooltip" style={{ left: tooltip.left, top: tooltip.top }}>{tooltip.text}</div> : null;
}

export default ThemedTooltipLayer;
