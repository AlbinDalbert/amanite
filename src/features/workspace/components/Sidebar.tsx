import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FractalPage } from "@/lib/fractal/types";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string | null;
  isBusy: boolean;
  folders: string[];
  pages: FractalPage[];
  projectName: string;
  onCreatePage: (title: string) => void;
  onCreateFolder: (folderPath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onMovePage: (pagePath: string, destination: string) => void;
  onOpenSettings: () => void;
  onSelectPage: (pagePath: string) => void;
  onValidate: () => void;
};

function Sidebar(props: SidebarProps) {
  const [createTitle, setCreateTitle] = useState<string | null>(null);
  const [createFolderPath, setCreateFolderPath] = useState<string | null>(null);
  const [movePath, setMovePath] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreateDialogOpen = createTitle !== null;

  useEffect(() => {
    if (!isCreateDialogOpen && createFolderPath === null && movePath === null) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [createFolderPath, isCreateDialogOpen, movePath]);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (createTitle?.trim()) props.onCreatePage(createTitle.trim());
    setCreateTitle(null);
  }

  function submitMove(event: FormEvent) {
    event.preventDefault();
    if (movePath && destination.trim()) props.onMovePage(movePath, destination.trim());
    setMovePath(null);
  }

  function submitCreateFolder(event: FormEvent) {
    event.preventDefault();
    if (createFolderPath?.trim()) props.onCreateFolder(createFolderPath.trim());
    setCreateFolderPath(null);
  }

  return (
    <aside className="sidebar" aria-label="File explorer">
      <div className="brand"><span className="brand-mark" aria-hidden="true" /><div><h1>Amanite</h1><p>{props.projectName}</p></div></div>
      <div className="explorer-header"><span>Pages</span><div className="explorer-header-actions"><button disabled={props.isBusy} onClick={() => setCreateFolderPath("New folder")} title="Create folder" type="button">▱</button><button disabled={props.isBusy} onClick={() => setCreateTitle("Untitled")} title="Create page" type="button">+</button></div></div>
      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={props.activePagePath}
          isBusy={props.isBusy}
          folders={props.folders}
          pages={props.pages}
          onCreateFolder={() => setCreateFolderPath("New folder")}
          onCreatePage={() => setCreateTitle("Untitled")}
          onDeletePage={props.onDeletePage}
          onDeleteFolder={props.onDeleteFolder}
          onMovePage={(path) => { setMovePath(path); setDestination(path); }}
          onSelectPage={props.onSelectPage}
          onValidate={props.onValidate}
        />
      </nav>
      <button className="sidebar-settings" onClick={props.onOpenSettings} type="button">
        <span className="settings-glyph" aria-hidden="true">✦</span>
        <span><strong>Settings</strong><small>Appearance and reading</small></span>
      </button>
      {createTitle !== null ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setCreateTitle(null)}>
          <form className="create-page-dialog" onSubmit={submitCreate} role="dialog" aria-modal="true">
            <div className="dialog-header"><p className="dialog-kicker">New document</p><h2>Create page</h2></div>
            <label className="dialog-field"><span>Title</span><input ref={inputRef} value={createTitle} onChange={(event) => setCreateTitle(event.currentTarget.value)} /></label>
            <p className="dialog-note">Fractal derives a safe filename from the title.</p>
            <div className="dialog-actions"><button className="ghost-action" onClick={() => setCreateTitle(null)} type="button">Cancel</button><button className="primary-action" type="submit">Create</button></div>
          </form>
        </div>
      ) : null}
      {createFolderPath !== null ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setCreateFolderPath(null)}>
          <form className="create-page-dialog" onSubmit={submitCreateFolder} role="dialog" aria-modal="true">
            <div className="dialog-header"><p className="dialog-kicker">New directory</p><h2>Create folder</h2></div>
            <label className="dialog-field"><span>Folder path</span><input ref={inputRef} value={createFolderPath} onChange={(event) => setCreateFolderPath(event.currentTarget.value)} /></label>
            <p className="dialog-note">Use slashes to create nested folders.</p>
            <div className="dialog-actions"><button className="ghost-action" onClick={() => setCreateFolderPath(null)} type="button">Cancel</button><button className="primary-action" type="submit">Create</button></div>
          </form>
        </div>
      ) : null}
      {movePath !== null ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setMovePath(null)}>
          <form className="create-page-dialog" onSubmit={submitMove} role="dialog" aria-modal="true">
            <div className="dialog-header"><p className="dialog-kicker">Move document</p><h2>Move page</h2></div>
            <label className="dialog-field"><span>Destination path</span><input ref={inputRef} value={destination} onChange={(event) => setDestination(event.currentTarget.value)} /></label>
            <p className="dialog-note">Fractal updates internal links that target this page.</p>
            <div className="dialog-actions"><button className="ghost-action" onClick={() => setMovePath(null)} type="button">Cancel</button><button className="primary-action" type="submit">Move</button></div>
          </form>
        </div>
      ) : null}
    </aside>
  );
}

export default Sidebar;
