import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from "react";
import type { FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string;
  canDeletePage: boolean;
  isBusy: boolean;
  directories: string[];
  pages: FractalPage[];
  projectName: string;
  onBuildIndex: () => void;
  onCreateDirectory: (parentPath: string, directoryName: string) => void;
  onCreatePage: (pagePath: string) => void;
  onDeleteDirectory: (directoryPath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onRenamePage: (pagePath: string, nextPagePath: string) => void;
  onSelectPage: (pagePath: string) => void;
  onValidate: () => void;
};

function Sidebar({
  activePagePath,
  canDeletePage,
  isBusy,
  directories,
  pages,
  projectName,
  onBuildIndex,
  onCreateDirectory,
  onCreatePage,
  onDeleteDirectory,
  onDeletePage,
  onRenamePage,
  onSelectPage,
  onValidate
}: SidebarProps) {
  const [createPageTitle, setCreatePageTitle] = useState<string | null>(null);
  const [createPageParentPath, setCreatePageParentPath] = useState("");
  const [createFolderName, setCreateFolderName] = useState<string | null>(null);
  const [createFolderParentPath, setCreateFolderParentPath] = useState("");
  const [renamePagePath, setRenamePagePath] = useState<string | null>(null);
  const [renameNextPagePath, setRenameNextPagePath] = useState("");
  const createPageInputRef = useRef<HTMLInputElement>(null);
  const createFolderInputRef = useRef<HTMLInputElement>(null);
  const renamePageInputRef = useRef<HTMLInputElement>(null);
  const wasCreatePageDialogOpenRef = useRef(false);
  const wasCreateFolderDialogOpenRef = useRef(false);
  const wasRenamePageDialogOpenRef = useRef(false);

  useEffect(() => {
    if (createPageTitle === null) {
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
  }, [createPageTitle]);

  useEffect(() => {
    if (createFolderName === null) {
      wasCreateFolderDialogOpenRef.current = false;
      return;
    }

    if (wasCreateFolderDialogOpenRef.current) {
      return;
    }

    wasCreateFolderDialogOpenRef.current = true;
    requestAnimationFrame(() => {
      createFolderInputRef.current?.focus();
      createFolderInputRef.current?.select();
    });
  }, [createFolderName]);

  useEffect(() => {
    if (renamePagePath === null) {
      wasRenamePageDialogOpenRef.current = false;
      return;
    }

    if (wasRenamePageDialogOpenRef.current) {
      return;
    }

    wasRenamePageDialogOpenRef.current = true;
    requestAnimationFrame(() => {
      renamePageInputRef.current?.focus();
      renamePageInputRef.current?.select();
    });
  }, [renamePagePath]);

  function slugifyFolderName(name: string) {
    return name
      .trim()
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function openCreatePageDialog(defaultTitle = "Untitled", parentPath = "") {
    setCreatePageParentPath(parentPath);
    setCreatePageTitle(defaultTitle);
  }

  function closeCreatePageDialog() {
    setCreatePageTitle(null);
    setCreatePageParentPath("");
  }

  function handleCreatePageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!createPageTitle) {
      return;
    }

    const trimmedPageTitle = createPageTitle.trim();
    if (trimmedPageTitle) {
      onCreatePage(createPageParentPath ? `${createPageParentPath}/${trimmedPageTitle}` : trimmedPageTitle);
      closeCreatePageDialog();
    }
  }

  function handleCreatePageBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeCreatePageDialog();
    }
  }

  function openCreateFolderDialog(parentPath = "") {
    setCreateFolderParentPath(parentPath);
    setCreateFolderName("new folder");
  }

  function closeCreateFolderDialog() {
    setCreateFolderName(null);
    setCreateFolderParentPath("");
  }

  function handleCreateFolderSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const folderSlug = createFolderName ? slugifyFolderName(createFolderName) : "";
    if (folderSlug) {
      onCreateDirectory(createFolderParentPath, folderSlug);
      closeCreateFolderDialog();
    }
  }

  function handleCreateFolderBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeCreateFolderDialog();
    }
  }

  function openRenamePageDialog(pagePath: string) {
    setRenamePagePath(pagePath);
    setRenameNextPagePath(pagePath);
  }

  function closeRenamePageDialog() {
    setRenamePagePath(null);
    setRenameNextPagePath("");
  }

  function handleRenamePageSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextPagePath = renameNextPagePath.trim();
    if (renamePagePath && nextPagePath) {
      onRenamePage(renamePagePath, nextPagePath);
      closeRenamePageDialog();
    }
  }

  function handleRenamePageBackdropClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) {
      closeRenamePageDialog();
    }
  }

  const createFolderSlug = createFolderName ? slugifyFolderName(createFolderName) : "";

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
      </div>

      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={activePagePath}
          canDeletePage={canDeletePage}
          directories={directories}
          isBusy={isBusy}
          pages={pages}
          onBuildIndex={onBuildIndex}
          onCreateDirectory={openCreateFolderDialog}
          onCreatePage={openCreatePageDialog}
          onDeleteDirectory={onDeleteDirectory}
          onDeletePage={onDeletePage}
          onRenamePage={openRenamePageDialog}
          onSelectPage={onSelectPage}
          onValidate={onValidate}
        />
      </nav>

      {createPageTitle !== null ? (
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
                onChange={(event) => setCreatePageTitle(event.currentTarget.value)}
                placeholder="Day Two"
                ref={createPageInputRef}
                value={createPageTitle}
              />
            </label>

            <p className="dialog-note">
              {createPageParentPath
                ? `Fractal will create this page inside ${createPageParentPath}.`
                : "Fractal will create this page at the project root."}
            </p>

            <div className="dialog-actions">
              <button className="ghost-action" onClick={closeCreatePageDialog} type="button">
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={isBusy || createPageTitle.trim().length === 0}
                type="submit"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {createFolderName !== null ? (
        <div
          className="modal-backdrop"
          onClick={handleCreateFolderBackdropClick}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeCreateFolderDialog();
            }
          }}
        >
          <form
            aria-labelledby="create-folder-title"
            aria-modal="true"
            className="create-page-dialog"
            onSubmit={handleCreateFolderSubmit}
            role="dialog"
          >
            <div className="dialog-header">
              <p className="dialog-kicker">Archive operation</p>
              <h2 id="create-folder-title">Create folder</h2>
            </div>

            <label className="dialog-field">
              <span>Folder name</span>
              <input
                autoComplete="off"
                disabled={isBusy}
                onChange={(event) => setCreateFolderName(event.currentTarget.value)}
                placeholder="Research notes"
                ref={createFolderInputRef}
                value={createFolderName}
              />
            </label>

            <p className="dialog-note">
              {createFolderSlug
                ? `Fractal will create ${createFolderParentPath ? `${createFolderParentPath}/` : ""}${createFolderSlug}.`
                : "Enter a folder name. Amanite will slugify it before creating."}
            </p>

            <div className="dialog-actions">
              <button className="ghost-action" onClick={closeCreateFolderDialog} type="button">
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={isBusy || createFolderSlug.length === 0}
                type="submit"
              >
                Create
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {renamePagePath !== null ? (
        <div
          className="modal-backdrop"
          onClick={handleRenamePageBackdropClick}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              closeRenamePageDialog();
            }
          }}
        >
          <form
            aria-labelledby="rename-page-title"
            aria-modal="true"
            className="create-page-dialog"
            onSubmit={handleRenamePageSubmit}
            role="dialog"
          >
            <div className="dialog-header">
              <p className="dialog-kicker">Archive operation</p>
              <h2 id="rename-page-title">Rename page</h2>
            </div>

            <label className="dialog-field">
              <span>Page path</span>
              <input
                autoComplete="off"
                disabled={isBusy}
                onChange={(event) => setRenameNextPagePath(event.currentTarget.value)}
                placeholder="folder/day-two"
                ref={renamePageInputRef}
                value={renameNextPagePath}
              />
            </label>

            <p className="dialog-note">Move or rename {renamePagePath} with a Fractal page path.</p>

            <div className="dialog-actions">
              <button className="ghost-action" onClick={closeRenamePageDialog} type="button">
                Cancel
              </button>
              <button
                className="primary-action"
                disabled={isBusy || renameNextPagePath.trim().length === 0}
                type="submit"
              >
                Rename
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

export default Sidebar;
