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
  onImportNativePage: (source: string, folderPath?: string) => void;
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
  const [filter, setFilter] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const isCreateDialogOpen = createTitle !== null;
  const rootFolder = props.folders.find((folder) => folder.path === "");

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
  function importDocument(folder?: string) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".fractal.html,text/html";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith(".fractal.html")) return;
      void file.text().then((source) => props.onImportNativePage(source, folder));
    };
    input.click();
  }

  return (
    <aside className="sidebar" aria-label="File explorer">
      <div aria-label="Resize page explorer" className="sidebar-resize-handle" onDoubleClick={props.onResizeReset} onPointerDown={props.onResizeStart} role="separator" />
      <div className="brand"><span className={`brand-mark logo-${props.logoMark}`} aria-hidden="true"><i /></span><div><h1>Amanite</h1><p>{props.projectName}</p></div><button onClick={props.onCloseProject} title="Close project" type="button">Projects</button></div>
      <div className="explorer-header"><button className={props.activeFolderPath === "" ? "explorer-root-open active" : "explorer-root-open"} onClick={() => props.onSelectFolder("")} title="Open the pages folder" type="button">{rootFolder?.title || "Pages"}</button><div className="explorer-header-actions"><button disabled={props.isBusy} onClick={() => importDocument()} title="Import .fractal.html" type="button"><Icon name="upload" size={15} /></button><button disabled={props.isBusy} onClick={() => startCreateFolder()} title="Create folder" type="button"><Icon name="folder-plus" size={16} /></button><button disabled={props.isBusy} onClick={() => startCreatePage()} title="Create page" type="button"><Icon name="file-plus" size={16} /></button></div></div>
      <label className="sidebar-filter"><Icon name="search" size={14} /><input aria-label="Filter pages" onChange={(event) => setFilter(event.currentTarget.value)} placeholder="Filter pages" value={filter} /></label>
      <nav className="file-explorer" aria-label="Project files">
        <FileExplorer
          activePagePath={props.activePagePath}
          activeFolderPath={props.activeFolderPath}
          isBusy={props.isBusy}
          folders={props.folders}
          pages={filter.trim() ? props.pages.filter((page) => `${page.title ?? ""} ${page.path} ${page.text}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase())) : props.pages}
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
