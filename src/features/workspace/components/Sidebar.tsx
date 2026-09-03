import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import type { FractalFolder, FractalPage } from "@/lib/fractal/types";
import type { LogoMark } from "@/app/useAppearanceSettings";
import Icon from "@/components/ui/Icon";
import FileExplorer from "./FileExplorer";

type SidebarProps = {
  activePagePath: string | null;
  activeFolderPath: string | null;
  isBusy: boolean;
  logoMark: LogoMark;
  folders: FractalFolder[];
  pages: FractalPage[];
  projectName: string;
  onCreatePage: (title: string, folderPath?: string) => void;
  onCloseProject: () => void;
  onCreateFolder: (folderPath: string) => void;
  onDeletePage: (pagePath: string) => void;
  onDeleteFolder: (folderPath: string) => void;
  onDuplicatePage: (pagePath: string) => void;
  onMovePage: (pagePath: string, destination: string) => void;
  onOpenSettings: () => void;
  onSelectPage: (pagePath: string) => void;
  onSelectFolder: (folderPath: string) => void;
  onRevealPage: (pagePath?: string) => void;
  onValidate: () => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
};

function Sidebar(props: SidebarProps) {
  const [createTitle, setCreateTitle] = useState<string | null>(null);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState<string | null>(null);
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [movePath, setMovePath] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreateDialogOpen = createTitle !== null;

  useEffect(() => {
    if (!isCreateDialogOpen && createFolderName === null && movePath === null) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [createFolderName !== null, isCreateDialogOpen, movePath]);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (createTitle?.trim()) props.onCreatePage(createTitle.trim(), createParent ?? undefined);
    setCreateTitle(null);
    setCreateParent(null);
  }

  function submitMove(event: FormEvent) {
    event.preventDefault();
    if (movePath && destination.trim()) props.onMovePage(movePath, destination.trim());
    setMovePath(null);
  }

  function submitCreateFolder(event: FormEvent) {
    event.preventDefault();
    if (createFolderName?.trim()) props.onCreateFolder([createFolderParent, createFolderName.trim()].filter(Boolean).join("/"));
    setCreateFolderName(null);
    setCreateFolderParent(null);
  }

  function startCreatePage(folder?: string) { setCreateParent(folder ?? null); setCreateTitle("Untitled"); }
  function startCreateFolder(folder?: string) { setCreateFolderParent(folder ?? null); setCreateFolderName("New folder"); }
  return (
    <aside className="sidebar" aria-label="File explorer">
      <div aria-label="Resize page explorer" className="sidebar-resize-handle" onDoubleClick={props.onResizeReset} onPointerDown={props.onResizeStart} role="separator" />
      <div className="brand">
        <button className={props.activeFolderPath === "" ? "brand-home active" : "brand-home"} onClick={() => props.onSelectFolder("")} title="Open project pages" type="button">
          <span className={`brand-mark logo-${props.logoMark}`} aria-hidden="true"><i /></span>
          <span><strong>Amanite</strong><small>{props.projectName}</small></span>
        </button>
        <button className="brand-projects" onClick={props.onCloseProject} title="Close project" type="button">Projects</button>
      </div>
      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={props.activePagePath}
          activeFolderPath={props.activeFolderPath}
          isBusy={props.isBusy}
          folders={props.folders}
          pages={props.pages}
          onCreateFolder={startCreateFolder}
          onCreatePage={startCreatePage}
          onDeletePage={props.onDeletePage}
          onDeleteFolder={props.onDeleteFolder}
          onDuplicatePage={props.onDuplicatePage}
          onMovePage={(path) => { setMovePath(path); setDestination(path); }}
          onDropPage={(path, folder) => {
            const fileName = path.split("/").at(-1)!;
            const nextPath = folder ? `${folder}/${fileName}` : fileName;
            if (nextPath !== path) props.onMovePage(path, nextPath);
          }}
          onSelectPage={props.onSelectPage}
          onSelectFolder={props.onSelectFolder}
          onRevealPage={props.onRevealPage}
          onValidate={props.onValidate}
        />
      </nav>
      <button className="sidebar-settings" onClick={props.onOpenSettings} type="button">
        <span className="settings-glyph" aria-hidden="true"><Icon name="settings" size={15} /></span>
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
      {createFolderName !== null ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setCreateFolderName(null)}>
          <form className="create-page-dialog" onSubmit={submitCreateFolder} role="dialog" aria-modal="true">
            <div className="dialog-header"><p className="dialog-kicker">New directory</p><h2>Create folder</h2></div>
            <label className="dialog-field"><span>Name</span><input ref={inputRef} value={createFolderName} onChange={(event) => setCreateFolderName(event.currentTarget.value)} /></label>
            <p className="dialog-note">{createFolderParent ? `Inside ${createFolderParent}` : "At the project root"}</p>
            <div className="dialog-actions"><button className="ghost-action" onClick={() => setCreateFolderName(null)} type="button">Cancel</button><button className="primary-action" type="submit">Create</button></div>
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
