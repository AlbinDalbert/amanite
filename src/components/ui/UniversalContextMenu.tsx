import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export type UniversalContextMenuAction = {
  disabled?: boolean;
  label: string;
  title?: string;
  variant?: "danger";
  onSelect: () => void;
};

type UniversalContextMenuProps = {
  actions?: UniversalContextMenuAction[];
  children: ReactNode;
};

type MenuState = {
  label: string;
  x: number;
  y: number;
};

function menuPosition(event: globalThis.MouseEvent, actionCount: number) {
  const menuWidth = 224;
  const menuHeight = Math.max(92, 52 + actionCount * 34);

  return {
    x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
    y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
  };
}

function menuSurfaceLabel(target: EventTarget | null) {
  const element = target instanceof HTMLElement ? target : null;

  if (element?.closest("textarea, input, [contenteditable='true']")) {
    return "Text field";
  }

  if (element?.closest(".fractal-inspector")) {
    return "Inspector";
  }

  if (element?.closest(".file-explorer, .sidebar")) {
    return "Explorer";
  }

  if (element?.closest(".workspace")) {
    return "Workspace";
  }

  if (element?.closest(".start-screen")) {
    return "Project library";
  }

  return "Amanite";
}

function UniversalContextMenu({ actions = [], children }: UniversalContextMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeExistingMenu() {
      setMenu(null);
    }

    window.addEventListener("contextmenu", closeExistingMenu, { capture: true });

    return () => {
      window.removeEventListener("contextmenu", closeExistingMenu, { capture: true });
    };
  }, []);

  useEffect(() => {
    function handleContextMenu(event: globalThis.MouseEvent) {
      const element = event.target instanceof HTMLElement ? event.target : null;

      setMenu(null);

      if (
        element?.closest(
          ".app-context-menu, .file-context-menu"
        )
      ) {
        event.preventDefault();
        return;
      }

      if (event.defaultPrevented) {
        return;
      }

      event.preventDefault();

      setMenu({
        label: menuSurfaceLabel(event.target),
        ...menuPosition(event, actions.length)
      });
    }

    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, [actions.length]);

  useEffect(() => {
    if (!menu) {
      return;
    }

    requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });

    function closeMenu() {
      setMenu(null);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
        return;
      }

      if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
        return;
      }

      const buttons = Array.from(
        menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []
      );
      if (buttons.length === 0) {
        return;
      }

      event.preventDefault();
      const currentIndex = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const delta = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (Math.max(0, currentIndex) + delta + buttons.length) % buttons.length;
      buttons[nextIndex]?.focus();
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menu]);

  function runAction(action: UniversalContextMenuAction) {
    if (action.disabled) {
      return;
    }

    setMenu(null);
    action.onSelect();
  }

  const menuStyle: CSSProperties | undefined = menu
    ? {
        left: menu.x,
        top: menu.y
      }
    : undefined;

  return (
    <div className="app-context-root">
      {children}

      {menu ? (
        <div
          aria-label="Amanite actions"
          className="app-context-menu"
          onClick={(event) => event.stopPropagation()}
          ref={menuRef}
          role="menu"
          style={menuStyle}
        >
          <div className="app-context-label">{menu.label}</div>

          {actions.length > 0 ? (
            actions.map((action) => (
              <button
                className={action.variant === "danger" ? "danger" : undefined}
                disabled={action.disabled}
                key={action.label}
                onClick={() => runAction(action)}
                role="menuitem"
                title={action.title}
                type="button"
              >
                {action.label}
              </button>
            ))
          ) : (
            <p className="app-context-empty">No direct actions on this surface.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default UniversalContextMenu;
