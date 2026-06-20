import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string;
  canDeletePage: boolean;
  isBusy: boolean;
  pages: FractalPage[];
  projectName: string;
  onBuildIndex: () => void;
  onCreatePage: (pagePath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSelectPage: (pagePath: string) => void;
  onValidate: () => void;
};

function Sidebar({
  activePagePath,
  canDeletePage,
  isBusy,
  pages,
  projectName,
  onBuildIndex,
  onCreatePage,
  onDeletePage,
  onRenamePage,
  onSelectPage,
  onValidate
}: SidebarProps) {
  const [createPagePath, setCreatePagePath] = useState<string | null>(null);
  const createPageInputRef = useRef<HTMLInputElement>(null);
  const wasCreatePageDialogOpenRef = useRef(false);

  useEffect(() => {
    if (createPagePath === null) {
      wasCreatePageDialogOpenRef.current = false;
      return;
    }

    if (wasCreatePageDialogOpenRef.current) {
      return;
    }

    wasCreatePageDialogOpenRef.current = true;
    requestAnimationFrame(() => {
      createPageInputRef.current?.focus();
      createPageInputRef.current?.select();
    });
  }, [createPagePath]);

  function openCreatePageDialog(defaultTitle = "Untitled") {
    setCreatePagePath(defaultTitle);
  }

  function closeCreatePageDialog() {
    setCreatePagePath(null);
  }

  function handleCreatePageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createPagePath) {
      return;
    }

    const trimmedPagePath = createPagePath.trim();
    if (trimmedPagePath) {
      onCreatePage(trimmedPagePath);
      closeCreatePageDialog();
    }
  }

  function handleCreatePageBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeCreatePageDialog();
    }
  }

  return (
    <aside className="sidebar" aria-label="File explorer">
      <div className="brand">
        <span className="brand-mark" aria-hidden="true" />
        <div>
          <h1>Amanite</h1>
          <p>{projectName}</p>
        </div>
      </div>

      <div className="explorer-header">
        <span>Pages</span>
        <button
          type="button"
          aria-label="Create page"
          disabled={isBusy}
          onClick={() => openCreatePageDialog()}
        >
          +
        </button>
      </div>

      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={activePagePath}
          canDeletePage={canDeletePage}
          isBusy={isBusy}
          pages={pages}
          onBuildIndex={onBuildIndex}
          onCreatePage={openCreatePageDialog}
          onDeletePage={onDeletePage}
          onRenamePage={onRenamePage}
          onSelectPage={onSelectPage}
          onValidate={onValidate}
        />
      </nav>

      {createPagePath !== null ? (
        <div
          className="modal-backdrop"
          onClick={handleCreatePageBackdropClick}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeCreatePageDialog();
            }
          }}
        >
          <form
            aria-labelledby="create-page-title"
            aria-modal="true"
            className="create-page-dialog"
            onSubmit={handleCreatePageSubmit}
            role="dialog"
          >
            <div className="dialog-header">
              <p className="dialog-kicker">Archive operation</p>
              <h2 id="create-page-title">Create page</h2>
            </div>

            <label className="dialog-field">
              <span>Page title</span>
              <input
                autoComplete="off"
                disabled={isBusy}
                onChange={(event) => setCreatePagePath(event.currentTarget.value)}
                placeholder="Day Two"
                ref={createPageInputRef}
                value={createPagePath}
              />
            </label>

            <p className="dialog-note">
              Fractal will use this title and generate the page file path from it.
            </p>

            <div className="dialog-actions">
              <button className="ghost-action" onClick={closeCreatePageDialog} type="button">
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={isBusy || createPagePath.trim().length === 0}
                type="submit"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

export default Sidebar;
