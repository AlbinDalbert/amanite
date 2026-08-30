import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent } from "react";
import Icon from "@/components/ui/Icon";
import TreeLocation from "@/components/ui/TreeLocation";
import { BorealisTrigger } from "@/features/ai-chat/components/AiChat";
import RichDocumentEditor from "@/features/editor/components/RichDocumentEditor";
import { analyzeEditablePage, writeEditableBody, writeEditableTitle } from "@/features/editor/components/pageSource";
import type { FractalFolder, FractalFolderHtmlExportOptions, FractalFolderHtmlExportReport, FractalNativeSection, FractalPage } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import FolderExportDialog, { buildFolderExportTree, type FolderExportNode } from "./FolderExportDialog";

const FOLDER_CHILD_MIME = "application/x-amanite-folder-child";

type Props = {
  buffers: Record<string, DocumentBuffer>;
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  folder: FractalFolder;
  folders: FractalFolder[];
  isBusy: boolean;
  loadingPaths: Set<string>;
  loadErrors: Record<string, string>;
  pages: FractalPage[];
  projectName: string;
  spellCheck: boolean;
  focusMode: boolean;
  onChangeSource: (path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onEnsurePage: (path: string) => Promise<boolean>;
  onExport: (options: FractalFolderHtmlExportOptions) => Promise<FractalFolderHtmlExportReport | null>;
  onOpenFolder: (path: string) => void;
  onOpenPage: (path: string) => void;
  onRemoveMissing: (kind: "folder" | "native", path: string) => void;
  onReorder: (order: string[]) => void;
  onSavePage: (path: string) => void;
  onSetTitle: (title: string) => void;
  onToggleBorealis: () => void;
  onToggleFocus: () => void;
};

export function folderChildPath(folderPath: string, name: string) {
  return folderPath ? `${folderPath}/${name}` : name;
}

export function directParent(path: string) {
  return path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
}

function wordLabel(text: string) {
  const words = text.trim() ? text.trim().split(/\s+/u).length : 0;
  return `${words.toLocaleString()} ${words === 1 ? "word" : "words"}`;
}

export type FolderFindPage = { path: string; title: string; matches: string[] };
export type FolderFindGroup = { path: string; title: string; pages: FolderFindPage[] };

function matchSnippets(text: string, query: string) {
  if (!query.trim()) return [];
  const matches: string[] = [];
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  let offset = 0;
  while ((offset = lowerText.indexOf(lowerQuery, offset)) >= 0) {
    const start = Math.max(0, offset - 52);
    const end = Math.min(text.length, offset + query.length + 76);
    matches.push(`${start ? "…" : ""}${text.slice(start, end).replace(/\s+/gu, " ")}${end < text.length ? "…" : ""}`);
    offset += Math.max(1, lowerQuery.length);
  }
  return matches;
}

export function buildFolderFindGroups(nodes: FolderExportNode[], pages: FractalPage[], query: string, rootTitle: string, rootPath: string): FolderFindGroup[] {
  const pageByPath = new Map(pages.map((page) => [page.path, page]));
  const groups: FolderFindGroup[] = [];
  function visit(children: FolderExportNode[], title: string, path: string) {
    let group: FolderFindGroup | undefined;
    for (const node of children) {
      if (node.kind === "folder") visit(node.children, node.title, node.projectPath);
      else {
        const page = pageByPath.get(node.projectPath);
        const matches = matchSnippets(`${page?.title ?? ""}\n${page?.text ?? ""}`, query);
        if (matches.length) {
          if (!group) { group = { path, title, pages: [] }; groups.push(group); }
          group.pages.push({ path: node.projectPath, title: node.title, matches });
        }
      }
    }
  }
  visit(nodes, rootTitle, rootPath);
  return groups;
}

export function shouldOpenFolderChild(target: EventTarget | null) {
  return !(target instanceof Element && target.closest("button, input, textarea, select, a, [contenteditable='true']"));
}

function FolderAddMenu({ onCreate }: { onCreate: (kind: "page" | "folder") => void }) {
  return (
    <div aria-label="Add to folder" className="folder-add-menu" role="menu">
      <button onClick={() => onCreate("page")} role="menuitem" type="button"><Icon name="file-plus" size={16} /><span><strong>New page</strong><small>Add a document here</small></span></button>
      <button onClick={() => onCreate("folder")} role="menuitem" type="button"><Icon name="folder-plus" size={16} /><span><strong>New folder</strong><small>Add a subfolder here</small></span></button>
    </div>
  );
}

function FolderAddControl({ isBusy, open, placement, onOpen, onCreate }: {
  isBusy: boolean;
  open: boolean;
  placement: "top" | "bottom";
  onOpen: () => void;
  onCreate: (kind: "page" | "folder") => void;
}) {
  return (
    <li className={`folder-add-row ${placement}${open ? " open" : ""}`}>
      <div aria-hidden="true" className="folder-add-spine"><i /></div>
      <div className="folder-add-anchor">
        <button aria-expanded={open} aria-haspopup="menu" aria-label={`Add to folder at ${placement}`} className="folder-add-ghost" disabled={isBusy} onClick={onOpen} type="button"><span aria-hidden="true">+</span></button>
        {open ? <FolderAddMenu onCreate={onCreate} /> : null}
      </div>
    </li>
  );
}

function EmptyFolderControl({ isBusy, open, onOpen, onCreate }: {
  isBusy: boolean;
  open: boolean;
  onOpen: () => void;
  onCreate: (kind: "page" | "folder") => void;
}) {
  return (
    <li className={`folder-empty-row${open ? " open" : ""}`}>
      <button aria-expanded={open} aria-haspopup="menu" className="folder-view-empty" disabled={isBusy} onClick={onOpen} type="button">
        <strong>Empty folder</strong><small>Click to add a page or folder.</small>
      </button>
      {open ? <FolderAddMenu onCreate={onCreate} /> : null}
    </li>
  );
}

function InlineFolderEditor({ buffer, isBusy, pages, spellCheck, onChangeSource }: {
  buffer: DocumentBuffer;
  isBusy: boolean;
  pages: FractalPage[];
  spellCheck: boolean;
  onChangeSource: (source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
}) {
  const analysis = useMemo(() => analyzeEditablePage(buffer.source), [buffer.source]);
  const protectedDocument = analysis.inspection.structuralIssues.length || analysis.inspection.compatibilityIssues.length;
  if (protectedDocument) {
    return <p className="folder-inline-protected">This page contains HTML the rich editor cannot preserve. Open it in its own tab to inspect it.</p>;
  }

  return (
    <RichDocumentEditor
      bodyHtml={analysis.page.bodyHtml}
      embedded
      isBusy={isBusy}
      pagePath={buffer.path}
      pages={pages}
      spellCheck={spellCheck}
      title={analysis.page.title}
      onChangeBody={(bodyHtml) => onChangeSource(writeEditableBody(buffer.source, bodyHtml, analysis.page.hasTitleHeading), { section: "content", value: bodyHtml })}
      onChangeTitle={(title) => onChangeSource(writeEditableTitle(buffer.source, title, analysis.page.hasTitleHeading), { section: "title", value: title })}
    />
  );
}

function FolderView(props: Props) {
  const [title, setTitle] = useState(props.folder.title);
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [draggedName, setDraggedName] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isFindOpen, setIsFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [addMenu, setAddMenu] = useState<"top" | "bottom" | "empty" | null>(null);
  const [createKind, setCreateKind] = useState<"page" | "folder" | null>(null);
  const [createName, setCreateName] = useState("");
  const createInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setTitle(props.folder.title), [props.folder.path, props.folder.title]);
  useEffect(() => setEditingPath(null), [props.folder.path]);
  useEffect(() => {
    if (!addMenu) return;
    const closeMenu = (event: globalThis.MouseEvent) => {
      if (!(event.target instanceof Element) || !event.target.closest(".folder-add-row, .folder-empty-row")) setAddMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setAddMenu(null); };
    window.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [addMenu]);
  useEffect(() => {
    if (!createKind) return;
    const frame = requestAnimationFrame(() => { createInputRef.current?.focus(); createInputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [createKind]);

  const orderedNames = props.folder.children.map((child) => child.name);
  const rawPages = props.pages.filter((page) => page.kind === "raw" && directParent(page.path) === props.folder.path);
  const nativeCount = props.folder.children.filter((child) => child.kind === "native" && child.status === "present").length;
  const folderCount = props.folder.children.filter((child) => child.kind === "folder" && child.status === "present").length;
  const exportTree = useMemo(() => buildFolderExportTree(props.folder, props.folders, props.pages), [props.folder, props.folders, props.pages]);
  const orderedPagePaths = useMemo(() => {
    const paths: string[] = [];
    const visit = (nodes: FolderExportNode[]) => nodes.forEach((node) => node.kind === "page" ? paths.push(node.projectPath) : visit(node.children));
    visit(exportTree);
    return paths;
  }, [exportTree]);
  const scopedPages = orderedPagePaths.map((path) => props.pages.find((page) => page.path === path)).filter((page): page is FractalPage => Boolean(page));
  const folderWords = scopedPages.reduce((total, page) => total + (page.text.trim() ? page.text.trim().split(/\s+/u).length : 0), 0);
  const folderCharacters = scopedPages.reduce((total, page) => total + page.text.length, 0);
  const findGroups = useMemo(() => buildFolderFindGroups(exportTree, props.pages, findQuery, props.folder.title, props.folder.path), [exportTree, findQuery, props.folder.path, props.folder.title, props.pages]);
  const findCount = findGroups.reduce((total, group) => total + group.pages.reduce((subtotal, page) => subtotal + page.matches.length, 0), 0);

  function commitTitle() {
    const next = title.trim();
    if (!next) {
      setTitle(props.folder.title);
      return;
    }
    if (next !== props.folder.title) props.onSetTitle(next);
  }

  function reorderAt(index: number) {
    if (!draggedName) return;
    const sourceIndex = orderedNames.indexOf(draggedName);
    if (sourceIndex < 0) return;
    const without = orderedNames.filter((name) => name !== draggedName);
    const insertion = Math.max(0, Math.min(index - (sourceIndex < index ? 1 : 0), without.length));
    const next = [...without.slice(0, insertion), draggedName, ...without.slice(insertion)];
    setDraggedName(null);
    setDropIndex(null);
    if (next.some((name, position) => name !== orderedNames[position])) props.onReorder(next);
  }

  function trackDrop(event: DragEvent, index: number) {
    if (!event.dataTransfer.types.includes(FOLDER_CHILD_MIME)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIndex(index + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0));
  }

  async function beginEditing(path: string) {
    if (editingPath === path) {
      setEditingPath(null);
      return;
    }
    if (await props.onEnsurePage(path)) setEditingPath(path);
  }

  function beginCreating(kind: "page" | "folder") {
    setAddMenu(null);
    setCreateKind(kind);
    setCreateName(kind === "page" ? "Untitled" : "New folder");
  }

  function submitCreate(event: FormEvent) {
    event.preventDefault();
    const name = createName.trim();
    if (!name || !createKind) return;
    if (createKind === "page") props.onCreatePage(name, props.folder.path || undefined);
    else props.onCreateFolder(folderChildPath(props.folder.path, name));
    setCreateKind(null);
  }

  function openChild(event: MouseEvent, kind: "folder" | "native", path: string, missing: boolean, editing: boolean) {
    if (missing || editing || !shouldOpenFolderChild(event.target)) return;
    if (kind === "folder") props.onOpenFolder(path);
    else props.onOpenPage(path);
  }

  return (
    <section className="folder-view-shell" aria-label={`Folder ${props.folder.title}`}>
      <div aria-label={`Folder ${props.folder.title}`} className="folder-view">
      <header className="folder-view-header">
        <div className="folder-view-eyebrow">
          <TreeLocation
            currentKind="folder"
            disabled={props.isBusy}
            onNavigateFolder={props.onOpenFolder}
            onUp={props.folder.path ? () => props.onOpenFolder(directParent(props.folder.path)) : undefined}
            path={props.folder.path}
            projectName={props.projectName}
            upTitle={`Go up to ${directParent(props.folder.path) || "Pages"}`}
          />
        </div>
        <input
          aria-label="Folder title"
          disabled={props.isBusy}
          onBlur={commitTitle}
          onChange={(event) => setTitle(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") { setTitle(props.folder.title); event.currentTarget.blur(); }
          }}
          value={title}
        />
        <div className="folder-view-summary">
          <span>{nativeCount} {nativeCount === 1 ? "page" : "pages"}</span>
          <span>{folderCount} {folderCount === 1 ? "folder" : "folders"}</span>
          <span>{props.folder.order ? "Custom order" : "Default order"}</span>
        </div>
      </header>

      <div className="folder-manuscript">
        <ol className="folder-sequence">
          {props.folder.children.length ? <FolderAddControl isBusy={props.isBusy} open={addMenu === "top"} placement="top" onCreate={beginCreating} onOpen={() => setAddMenu((current) => current === "top" ? null : "top")} /> : null}
          {!props.folder.children.length ? <EmptyFolderControl isBusy={props.isBusy} open={addMenu === "empty"} onCreate={beginCreating} onOpen={() => setAddMenu((current) => current === "empty" ? null : "empty")} /> : null}
          {props.folder.children.map((child, index) => {
            const path = folderChildPath(props.folder.path, child.name);
            const page = child.kind === "native" ? props.pages.find((candidate) => candidate.path === path) : undefined;
            const buffer = props.buffers[path];
            const isEditing = path === editingPath;
            const missing = child.status === "missing";
            return (
              <li
                className={`folder-sequence-item ${child.kind}${missing ? " missing" : ""}${isEditing ? " editing" : ""}${dropIndex === index ? " drop-before" : ""}`}
                draggable={!props.isBusy && !isEditing}
                key={`${child.kind}:${child.name}`}
                onDragEnd={() => { setDraggedName(null); setDropIndex(null); }}
                onDragOver={(event) => trackDrop(event, index)}
                onDragStart={(event) => {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData(FOLDER_CHILD_MIME, child.name);
                  setDraggedName(child.name);
                }}
                onDrop={(event) => { event.preventDefault(); reorderAt(dropIndex ?? index); }}
              >
                <div className="folder-sequence-spine"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
                <article className="folder-sequence-card" onDoubleClick={(event) => openChild(event, child.kind, path, missing, isEditing)} title={!missing && !isEditing ? "Double-click to open" : undefined}>
                  <header>
                    <div>
                      <small>{child.kind === "folder" ? "Folder" : missing ? "Missing page" : wordLabel(page?.text ?? "")}</small>
                      <h2>{child.kind === "folder" ? props.folders.find((candidate) => candidate.path === path)?.title || child.name : page?.title?.trim() || child.name}</h2>
                      <code>{path}</code>
                    </div>
                    <div className="folder-sequence-actions">
                      {missing ? <button onClick={() => props.onRemoveMissing(child.kind, path)} type="button">Remove missing entry</button> : null}
                      {child.kind === "folder" && !missing ? <button onClick={() => props.onOpenFolder(path)} type="button">Open folder</button> : null}
                      {page && !missing ? <>
                        <button onClick={() => void beginEditing(path)} type="button">{isEditing ? "Close editor" : "Edit here"}</button>
                        <button onClick={() => props.onOpenPage(path)} type="button">Open page</button>
                        {buffer?.dirty ? <button className="folder-save-page" onClick={() => props.onSavePage(path)} type="button">Save</button> : null}
                      </> : null}
                    </div>
                  </header>
                  {missing ? <p className="folder-missing-copy">Fractal kept this place because the item was removed outside the project engine.</p> : null}
                  {page && !isEditing ? <p className="folder-page-preview">{page.text.trim() || "This page is empty."}</p> : null}
                  {isEditing && props.loadingPaths.has(path) ? <p className="folder-inline-state">Loading page…</p> : null}
                  {isEditing && props.loadErrors[path] ? <p className="folder-inline-state error">{props.loadErrors[path]}</p> : null}
                  {isEditing && buffer ? (
                    <div className="folder-document-editor">
                      <InlineFolderEditor buffer={buffer} isBusy={props.isBusy} pages={props.pages} spellCheck={props.spellCheck} onChangeSource={(source, nativeSection) => props.onChangeSource(path, source, nativeSection)} />
                      {buffer.error ? <p className="folder-inline-state error">{buffer.error}</p> : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
          {dropIndex === props.folder.children.length ? <li className="folder-sequence-end-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); reorderAt(props.folder.children.length); }} /> : null}
          {props.folder.children.length ? <FolderAddControl isBusy={props.isBusy} open={addMenu === "bottom"} placement="bottom" onCreate={beginCreating} onOpen={() => setAddMenu((current) => current === "bottom" ? null : "bottom")} /> : null}
        </ol>

        {rawPages.length ? (
          <section className="folder-other-pages">
            <header><span>Other HTML</span><small>Raw HTML stays outside folder order.</small></header>
            {rawPages.map((page) => <button key={page.path} onClick={() => props.onOpenPage(page.path)} type="button"><strong>{page.title || page.path.split("/").at(-1)}</strong><code>{page.path}</code></button>)}
          </section>
        ) : null}

        {props.folder.issues.length ? (
          <section className="folder-issues"><span>Folder issues</span>{props.folder.issues.map((issue) => <p key={`${issue.name}:${issue.message}`}><strong>{issue.name}</strong>{issue.message}</p>)}</section>
        ) : null}
      </div>
      </div>
      {isFindOpen ? (
        <aside aria-label="Find in folder" className="folder-find-drawer">
          <header><div><small>Find in folder</small><strong>{props.folder.title}</strong></div><button aria-label="Close find" onClick={() => setIsFindOpen(false)} type="button">×</button></header>
          <label><span>Search</span><input autoFocus onChange={(event) => setFindQuery(event.currentTarget.value)} placeholder="Find text in this folder" value={findQuery} /></label>
          <p className="folder-find-count">{findQuery ? `${findCount} ${findCount === 1 ? "match" : "matches"}` : "Type to search every page in export order."}</p>
          <div className="folder-find-results">
            {findQuery && !findCount ? <p>No matches in this folder.</p> : null}
            {findGroups.map((group) => <section key={group.path}><header><strong>{group.title}</strong><code>{group.path || "Pages"}</code></header>{group.pages.map((page) => <div className="folder-find-page" key={page.path}><button onClick={() => props.onOpenPage(page.path)} type="button"><strong>{page.title}</strong><small>{page.matches.length} {page.matches.length === 1 ? "match" : "matches"}</small></button>{page.matches.map((snippet, index) => <p key={`${page.path}:${index}`}>{snippet}</p>)}</div>)}</section>)}
          </div>
        </aside>
      ) : null}
      <footer className="document-status-bar folder-status-bar">
        <div><span>{folderWords.toLocaleString()} words</span><span>{folderCharacters.toLocaleString()} characters</span><span>{scopedPages.length.toLocaleString()} pages</span></div>
        <div className="document-status-actions"><button aria-pressed={isFindOpen} onClick={() => setIsFindOpen((open) => !open)} type="button">Find</button><button disabled={props.isBusy} onClick={() => setIsExportOpen(true)} type="button">Export</button><BorealisTrigger isOpen={props.borealisOpen} isWorkspace={props.borealisWorkspace} onClick={props.onToggleBorealis} /><button aria-pressed={props.focusMode} onClick={props.onToggleFocus} type="button">{props.focusMode ? "Exit focus" : "Focus"}</button></div>
      </footer>
      {isExportOpen ? <FolderExportDialog folder={props.folder} folders={props.folders} pages={props.pages} onClose={() => setIsExportOpen(false)} onExport={props.onExport} /> : null}
      {createKind ? (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && setCreateKind(null)}>
          <form aria-labelledby="folder-create-title" aria-modal="true" className="create-page-dialog" onSubmit={submitCreate} role="dialog">
            <div className="dialog-header"><p className="dialog-kicker">Inside {props.folder.title}</p><h2 id="folder-create-title">Create {createKind}</h2></div>
            <label className="dialog-field"><span>{createKind === "page" ? "Title" : "Name"}</span><input onChange={(event) => setCreateName(event.currentTarget.value)} ref={createInputRef} value={createName} /></label>
            <p className="dialog-note">{createKind === "page" ? "Fractal derives the filename from the title." : "The folder will appear in this sequence."}</p>
            <div className="dialog-actions"><button className="ghost-action" onClick={() => setCreateKind(null)} type="button">Cancel</button><button className="primary-action" disabled={!createName.trim()} type="submit">Create</button></div>
          </form>
        </div>
      ) : null}
    </section>
  );
}

export default FolderView;
