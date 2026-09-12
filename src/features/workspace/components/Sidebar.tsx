import { useEffect, useRef, useState, type Dispatch, type FormEvent, type PointerEvent, type RefObject, type SetStateAction } from "react";
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
  onMovePage: (pagePath: string, destinationFolder: string) => void;
  onOpenSettings: () => void;
  onSelectPage: (pagePath: string) => void;
  onSelectFolder: (folderPath: string) => void;
  onRevealPage: (pagePath?: string) => void;
  onValidate: () => void;
  onResizeStart: (event: PointerEvent<HTMLDivElement>) => void;
  onResizeReset: () => void;
};

function pageFolder(path: string) {
  const separator = path.lastIndexOf("/");
  return separator < 0 ? "" : path.slice(0, separator);
}

function moveDroppedPage(path: string, folder: string | undefined, onMovePage: SidebarProps["onMovePage"]) {
  const destination = folder ?? "";
  if (destination === pageFolder(path)) return;
  onMovePage(path, destination);
}

type SidebarDialogState = {
  createFolderName: string | null;
  createFolderParent: string | null;
  createTitle: string | null;
  createParent: string | null;
  destination: string;
  inputRef: RefObject<HTMLInputElement | null>;
  movePath: string | null;
  moveSelectRef: RefObject<HTMLSelectElement | null>;
  setCreateFolderName: Dispatch<SetStateAction<string | null>>;
  setCreateTitle: Dispatch<SetStateAction<string | null>>;
  setDestination: Dispatch<SetStateAction<string>>;
  setMovePath: Dispatch<SetStateAction<string | null>>;
  submitCreate: (event: FormEvent) => void;
  submitCreateFolder: (event: FormEvent) => void;
  submitMove: (event: FormEvent) => void;
  startCreateFolder: (folder?: string) => void;
  startCreatePage: (folder?: string) => void;
  openMove: (path: string) => void;
};

function useSidebarDialogState({ onCreateFolder, onCreatePage, onMovePage }: Pick<SidebarProps, "onCreateFolder" | "onCreatePage" | "onMovePage">): SidebarDialogState {
  const [createTitle, setCreateTitle] = useState<string | null>(null);
  const [createParent, setCreateParent] = useState<string | null>(null);
  const [createFolderName, setCreateFolderName] = useState<string | null>(null);
  const [createFolderParent, setCreateFolderParent] = useState<string | null>(null);
  const [movePath, setMovePath] = useState<string | null>(null);
  const [destination, setDestination] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const moveSelectRef = useRef<HTMLSelectElement>(null);
  const isCreateDialogOpen = createTitle !== null;

  useEffect(() => {
    if (!isCreateDialogOpen && createFolderName === null && movePath === null) return;
    const frame = requestAnimationFrame(() => {
      if (movePath) moveSelectRef.current?.focus();
      else {
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [createFolderName !== null, isCreateDialogOpen, movePath]);

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (createTitle?.trim()) onCreatePage(createTitle.trim(), createParent ?? undefined);
    setCreateTitle(null);
    setCreateParent(null);
  }

  function submitMove(event: FormEvent) {
    event.preventDefault();
    if (movePath) onMovePage(movePath, destination);
    setMovePath(null);
  }

  function submitCreateFolder(event: FormEvent) {
    event.preventDefault();
    if (createFolderName?.trim()) {
      const folderName = createFolderName.trim();
      onCreateFolder(createFolderParent ? `${createFolderParent}/${folderName}` : folderName);
    }
    setCreateFolderName(null);
    setCreateFolderParent(null);
  }

  function startCreatePage(folder?: string) { setCreateParent(folder ?? null); setCreateTitle("Untitled"); }
  function startCreateFolder(folder?: string) { setCreateFolderParent(folder ?? null); setCreateFolderName("New folder"); }
  function openMove(path: string) {
    setMovePath(path);
    setDestination(pageFolder(path));
  }

  return {
    createFolderName,
    createFolderParent,
    createTitle,
    createParent,
    destination,
    inputRef,
    movePath,
    moveSelectRef,
    setCreateFolderName,
    setCreateTitle,
    setDestination,
    setMovePath,
    submitCreate,
    submitCreateFolder,
    submitMove,
    startCreateFolder,
    startCreatePage,
    openMove
  };
}

function CreatePageDialog({ state }: { state: SidebarDialogState }) {
  if (state.createTitle === null) return null;
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && state.setCreateTitle(null)}>
      <form className="create-page-dialog" onSubmit={state.submitCreate} role="dialog" aria-modal="true">
        <div className="dialog-header"><p className="dialog-kicker">New document</p><h2>Create page</h2></div>
        <label className="dialog-field"><span>Title</span><input ref={state.inputRef} value={state.createTitle} onChange={(event) => state.setCreateTitle(event.currentTarget.value)} /></label>
        <p className="dialog-note">Fractal derives a safe filename from the title.</p>
        <div className="dialog-actions"><button className="ghost-action" onClick={() => state.setCreateTitle(null)} type="button">Cancel</button><button className="primary-action" type="submit">Create</button></div>
      </form>
    </div>
  );
}

function CreateFolderDialog({ state }: { state: SidebarDialogState }) {
  if (state.createFolderName === null) return null;
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && state.setCreateFolderName(null)}>
      <form className="create-page-dialog" onSubmit={state.submitCreateFolder} role="dialog" aria-modal="true">
        <div className="dialog-header"><p className="dialog-kicker">New directory</p><h2>Create folder</h2></div>
        <label className="dialog-field"><span>Name</span><input ref={state.inputRef} value={state.createFolderName} onChange={(event) => state.setCreateFolderName(event.currentTarget.value)} /></label>
        <p className="dialog-note">{state.createFolderParent ? `Inside ${state.createFolderParent}` : "At the project root"}</p>
        <div className="dialog-actions"><button className="ghost-action" onClick={() => state.setCreateFolderName(null)} type="button">Cancel</button><button className="primary-action" type="submit">Create</button></div>
      </form>
    </div>
  );
}

function MovePageDialog({ folders, state }: { folders: FractalFolder[]; state: SidebarDialogState }) {
  if (state.movePath === null) return null;
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && state.setMovePath(null)}>
      <form className="create-page-dialog" onSubmit={state.submitMove} role="dialog" aria-modal="true">
        <div className="dialog-header"><p className="dialog-kicker">Move document</p><h2>Move page</h2></div>
        <label className="dialog-field"><span>Destination folder</span><select ref={state.moveSelectRef} value={state.destination} onChange={(event) => state.setDestination(event.currentTarget.value)}><option value="">Pages</option>{folders.filter((folder) => folder.path).map((folder) => <option key={folder.path} value={folder.path}>{folder.title} ({folder.path})</option>)}</select></label>
        <p className="dialog-note">Fractal updates internal links that target this page.</p>
        <div className="dialog-actions"><button className="ghost-action" onClick={() => state.setMovePath(null)} type="button">Cancel</button><button className="primary-action" type="submit">Move</button></div>
      </form>
    </div>
  );
}

function Sidebar(props: SidebarProps) {
  const dialogs = useSidebarDialogState({ onCreateFolder: props.onCreateFolder, onCreatePage: props.onCreatePage, onMovePage: props.onMovePage });
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
          onCreateFolder={dialogs.startCreateFolder}
          onCreatePage={dialogs.startCreatePage}
          onDeletePage={props.onDeletePage}
          onDeleteFolder={props.onDeleteFolder}
          onDuplicatePage={props.onDuplicatePage}
          onMovePage={dialogs.openMove}
          onDropPage={(path, folder) => moveDroppedPage(path, folder, props.onMovePage)}
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
      <CreatePageDialog state={dialogs} />
      <CreateFolderDialog state={dialogs} />
      <MovePageDialog folders={props.folders} state={dialogs} />
    </aside>
  );
}

export default Sidebar;
