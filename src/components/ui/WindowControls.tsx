import { getCurrentWindow } from "@tauri-apps/api/window";
import type { MouseEvent } from "react";
import Icon from "./Icon";

type WindowCommand = "close" | "fullscreen" | "minimize";

type WindowControlsProps = {
  className?: string;
  onCloseRequest?: () => void;
};

function hasTauriRuntime() {
  return "__TAURI_INTERNALS__" in window;
}

async function runWindowCommand(command: WindowCommand) {
  if (!hasTauriRuntime()) {
    if (command === "fullscreen") {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } else if (command === "close") {
      window.close();
    }

    return;
  }

  const appWindow = getCurrentWindow();

  if (command === "minimize") {
    await appWindow.minimize();
  } else if (command === "fullscreen") {
    await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
  } else {
    await appWindow.close();
  }
}

function runWindowCommandSafely(command: WindowCommand) {
  void runWindowCommand(command).catch((error: unknown) => {
    if (import.meta.env.DEV) {
      console.warn(`Could not ${command} Amanite window.`, error);
    }
  });
}

export function handleWindowDragMouseDown(event: MouseEvent<HTMLElement>) {
  if (event.button !== 0) {
    return;
  }

  const target = event.target instanceof HTMLElement ? event.target : null;

  if (target?.closest("button, input, textarea, select, a, [role='button']")) {
    return;
  }

  if (!hasTauriRuntime()) {
    return;
  }

  const appWindow = getCurrentWindow();

  if (event.detail === 2) {
    void appWindow.toggleMaximize().catch(() => undefined);
    return;
  }

  void appWindow.startDragging().catch(() => undefined);
}

function WindowControls({ className, onCloseRequest }: WindowControlsProps) {
  const classNames = className ? `window-controls ${className}` : "window-controls";

  return (
    <div className={classNames} aria-label="Window controls">
      <button
        aria-label="Minimize window"
        className="window-control minimize"
        onClick={() => runWindowCommandSafely("minimize")}
        title="Minimize"
        type="button"
      >
        <Icon name="minimize" size={14} />
      </button>
      <button
        aria-label="Toggle fullscreen"
        className="window-control fullscreen"
        onClick={() => runWindowCommandSafely("fullscreen")}
        title="Fullscreen"
        type="button"
      >
        <Icon name="maximize" size={13} />
      </button>
      <button
        aria-label="Close window"
        className="window-control close"
        onClick={() => onCloseRequest ? onCloseRequest() : runWindowCommandSafely("close")}
        title="Close"
        type="button"
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

export default WindowControls;
