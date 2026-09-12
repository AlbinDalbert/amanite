import type { CSSProperties } from "react";
import type { FileExplorerMenu } from "./fileExplorerTypes";

type Props = {
  isBusy: boolean;
  menu: FileExplorerMenu;
  onCreateFolder: (parent?: string) => void;
  onCreatePage: (parent?: string) => void;
  onDeleteFolder: (path: string) => void;
  onDeletePage: (path: string) => void;
  onDuplicatePage: (path: string) => void;
  onMovePage: (path: string) => void;
  onRevealPage: (path?: string) => void;
  onRun: (action: () => void) => void;
  onSelectFolder: (path: string) => void;
  onSelectPage: (path: string) => void;
  onValidate: () => void;
};

function PageContextActions({ isBusy, menu, onDeletePage, onDuplicatePage, onMovePage, onRevealPage, onRun, onSelectPage }: Pick<Props, "isBusy" | "menu" | "onDeletePage" | "onDuplicatePage" | "onMovePage" | "onRevealPage" | "onRun" | "onSelectPage">) {
  if (menu.kind !== "page" || !menu.path) return null;
  const path = menu.path;
  return (
    <>
      <button disabled={isBusy} onClick={() => onRun(() => onSelectPage(path))} role="menuitem">Open</button>
      <button disabled={isBusy} onClick={() => onRun(() => onMovePage(path))} role="menuitem">Move</button>
      <button disabled={isBusy} onClick={() => onRun(() => onDuplicatePage(path))} role="menuitem">Duplicate</button>
      <button disabled={isBusy} onClick={() => onRun(() => onRevealPage(path))} role="menuitem">Reveal in file manager</button>
      <button className="danger" disabled={isBusy} onClick={() => onRun(() => onDeletePage(path))} role="menuitem">Delete</button>
      <div className="file-context-separator" />
    </>
  );
}

function FolderContextActions({ isBusy, menu, onCreateFolder, onCreatePage, onDeleteFolder, onRun, onSelectFolder }: Pick<Props, "isBusy" | "menu" | "onCreateFolder" | "onCreatePage" | "onDeleteFolder" | "onRun" | "onSelectFolder">) {
  if (menu.kind !== "folder" || !menu.path) return null;
  const path = menu.path;
  return (
    <>
      <button disabled={isBusy} onClick={() => onRun(() => onSelectFolder(path))} role="menuitem">Open folder</button>
      <button disabled={isBusy} onClick={() => onRun(() => onCreatePage(path))} role="menuitem">New page here</button>
      <button disabled={isBusy} onClick={() => onRun(() => onCreateFolder(path))} role="menuitem">New subfolder</button>
      <button className="danger" disabled={isBusy} onClick={() => onRun(() => onDeleteFolder(path))} role="menuitem">Delete folder</button>
      <div className="file-context-separator" />
    </>
  );
}

function ProjectCreationActions({ isBusy, menu, onCreateFolder, onCreatePage, onRun }: Pick<Props, "isBusy" | "menu" | "onCreateFolder" | "onCreatePage" | "onRun">) {
  if (menu.kind === "folder") return null;
  return (
    <>
      <button disabled={isBusy} onClick={() => onRun(() => onCreatePage())} role="menuitem">Create page</button>
      <button disabled={isBusy} onClick={() => onRun(() => onCreateFolder())} role="menuitem">Create folder</button>
      <div className="file-context-separator" />
    </>
  );
}

function CommonContextActions({ isBusy, onRevealPage, onRun, onValidate }: Pick<Props, "isBusy" | "onRevealPage" | "onRun" | "onValidate">) {
  return (
    <>
      <button disabled={isBusy} onClick={() => onRun(onValidate)} role="menuitem">Validate project</button>
      <button disabled={isBusy} onClick={() => onRun(() => onRevealPage())} role="menuitem">Reveal project folder</button>
    </>
  );
}

export default function FileExplorerContextMenu({ isBusy, menu, onCreateFolder, onCreatePage, onDeleteFolder, onDeletePage, onDuplicatePage, onMovePage, onRevealPage, onRun, onSelectFolder, onSelectPage, onValidate }: Props) {
  return (
    <div className="file-context-menu" role="menu" style={{ left: menu.x, top: menu.y } as CSSProperties}>
      <div className="file-context-label">{menu.path ?? "Project"}</div>
      <PageContextActions isBusy={isBusy} menu={menu} onDeletePage={onDeletePage} onDuplicatePage={onDuplicatePage} onMovePage={onMovePage} onRevealPage={onRevealPage} onRun={onRun} onSelectPage={onSelectPage} />
      <FolderContextActions isBusy={isBusy} menu={menu} onCreateFolder={onCreateFolder} onCreatePage={onCreatePage} onDeleteFolder={onDeleteFolder} onRun={onRun} onSelectFolder={onSelectFolder} />
      <ProjectCreationActions isBusy={isBusy} menu={menu} onCreateFolder={onCreateFolder} onCreatePage={onCreatePage} onRun={onRun} />
      <CommonContextActions isBusy={isBusy} onRevealPage={onRevealPage} onRun={onRun} onValidate={onValidate} />
    </div>
  );
}
