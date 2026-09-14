import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent, type MouseEvent, type RefObject } from "react";
import Icon from "@/components/ui/Icon";
import TreeLocation from "@/components/ui/TreeLocation";
import { BorealisTrigger } from "@/features/ai-chat/components/AiChat";
import RichDocumentEditor, { ReadOnlyDocumentMirror } from "@/features/editor/components/RichDocumentEditor";
import { analyzeEditablePage } from "@/features/editor/components/pageSource";
import { useSharedDocumentEditor } from "@/features/editor/components/sharedDocumentEditor";
import type { FractalFolder, FractalFolderHtmlExportOptions, FractalFolderHtmlExportReport, FractalNativeSection, FractalPage } from "@/lib/fractal/types";
import type { DocumentBuffer } from "../useWorkspaceDocuments";
import type { WorkspaceDocumentCallbacks } from "../workspaceCallbacks";
import FolderExportDialog from "./FolderExportDialog";
import { buildFolderExportTree, type FolderExportNode } from "./folderExportTreeBuilder";

const FOLDER_CHILD_MIME = "application/x-amanite-folder-child";

type Props = WorkspaceDocumentCallbacks & {
  buffers: Record<string, DocumentBuffer>;
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  folder: FractalFolder;
  editorOwner: boolean;
  folders: FractalFolder[];
  isBusy: boolean;
  loadingPaths: Set<string>;
  loadErrors: Record<string, string>;
  pages: FractalPage[];
  projectName: string;
  spellCheck: boolean;
  focusMode: boolean;
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

function InlineFolderEditor({ buffer, editorOwner, isBusy, pages, spellCheck, viewId, onChangeSource, onRevision, onSnapshot }: {
  buffer: DocumentBuffer;
  editorOwner: boolean;
  isBusy: boolean;
  pages: FractalPage[];
  spellCheck: boolean;
  viewId: string;
  onRevision?: (path: string, revision?: number) => void;
  onSnapshot?: (path: string, bodyHtml: string, revision: number) => void;
  onChangeSource: (source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
}) {
  const analysis = useMemo(() => analyzeEditablePage(buffer.source), [buffer.source]);
  const protectedDocument = !buffer.nativeDocumentParts || analysis.inspection.compatibilityIssues.length;
  if (protectedDocument) {
    return <p className="folder-inline-protected">This page contains HTML the rich editor cannot preserve. Open it in its own tab to inspect it.</p>;
  }

  return <LoadedInlineFolderEditor analysis={analysis} buffer={buffer} editorOwner={editorOwner} isBusy={isBusy} pages={pages} spellCheck={spellCheck} viewId={viewId} onChangeSource={onChangeSource} onRevision={onRevision} onSnapshot={onSnapshot} />;
}

function LoadedInlineFolderEditor({ analysis, buffer, editorOwner, isBusy, pages, spellCheck, viewId, onChangeSource, onRevision, onSnapshot }: {
  analysis: ReturnType<typeof analyzeEditablePage>;
  buffer: DocumentBuffer;
  editorOwner: boolean;
  isBusy: boolean;
  pages: FractalPage[];
  spellCheck: boolean;
  viewId: string;
  onRevision?: (path: string, revision?: number) => void;
  onSnapshot?: (path: string, bodyHtml: string, revision: number) => void;
  onChangeSource: (source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
}) {
  const session = useSharedDocumentEditor(buffer.documentId, buffer.projectGeneration, analysis.page.bodyHtml);
  if (!editorOwner) {
    return <ReadOnlyDocumentMirror bodyHtml={analysis.page.bodyHtml} embedded pagePath={buffer.path} session={session} title={analysis.page.title} />;
  }

  function changeTitle(title: string) {
    const revision = session.nextRevision();
    onRevision?.(buffer.path, revision);
    onChangeSource(buffer.source, { section: "title", value: title });
  }

  return (
    <RichDocumentEditor
      bodyHtml={analysis.page.bodyHtml}
      embedded
      documentId={buffer.documentId}
      isBusy={isBusy}
      pagePath={buffer.path}
      pages={pages}
      spellCheck={spellCheck}
      title={analysis.page.title}
      sharedSession={session}
      viewId={viewId}
      onChangeBody={() => undefined}
      onChangeTitle={changeTitle}
      onRevision={(revision) => onRevision?.(buffer.path, revision)}
      onSnapshot={(snapshot) => onSnapshot?.(buffer.path, snapshot.bodyHtml, snapshot.revision)}
    />
  );
}

type FolderSequenceInteractions = {
  editorOwner: boolean;
  folders: FractalFolder[];
  isBusy: boolean;
  loadErrors: Record<string, string>;
  loadingPaths: Set<string>;
  onBeginEditing: (path: string) => void;
  onChangeSource: Props["onChangeSource"];
  onRevision: Props["onRevision"];
  onSnapshot: Props["onSnapshot"];
  onDragEnd: () => void;
  onDragStartName: (name: string) => void;
  onOpenChild: (event: MouseEvent, kind: "folder" | "native", path: string, missing: boolean, editing: boolean) => void;
  onOpenFolder: Props["onOpenFolder"];
  onOpenPage: Props["onOpenPage"];
  onRemoveMissing: Props["onRemoveMissing"];
  onReorderAt: (index: number) => void;
  onSavePage: Props["onSavePage"];
  onTrackDrop: (event: DragEvent, index: number) => void;
  pages: FractalPage[];
  spellCheck: boolean;
};

type FolderSequenceItemProps = FolderSequenceInteractions & {
  buffer?: DocumentBuffer;
  child: FractalFolder["children"][number];
  dropIndex: number | null;
  editingPath: string | null;
  folderPath: string;
  index: number;
};

type FolderSequenceActionsProps = {
  buffer?: DocumentBuffer;
  child: FractalFolder["children"][number];
  isEditing: boolean;
  missing: boolean;
  onBeginEditing: (path: string) => void;
  onOpenFolder: Props["onOpenFolder"];
  onOpenPage: Props["onOpenPage"];
  onRemoveMissing: Props["onRemoveMissing"];
  onSavePage: Props["onSavePage"];
  page?: FractalPage;
  path: string;
};

function FolderSequenceActions({ buffer, child, isEditing, missing, onBeginEditing, onOpenFolder, onOpenPage, onRemoveMissing, onSavePage, page, path }: FolderSequenceActionsProps) {
  return (
    <div className="folder-sequence-actions">
      {missing ? <button onClick={() => onRemoveMissing(child.kind, path)} type="button">Remove missing entry</button> : null}
      {child.kind === "folder" && !missing ? <button onClick={() => onOpenFolder(path)} type="button">Open folder</button> : null}
      {page && !missing ? <>
        <button onClick={() => onBeginEditing(path)} type="button">{isEditing ? "Close editor" : "Edit here"}</button>
        <button onClick={() => onOpenPage(path)} type="button">Open page</button>
        {buffer?.dirty ? <button className="folder-save-page" onClick={() => onSavePage(path)} type="button">Save</button> : null}
      </> : null}
    </div>
  );
}

type FolderSequenceCardProps = Omit<FolderSequenceItemProps, "dropIndex" | "editingPath" | "folderPath" | "index" | "onDragEnd" | "onDragStartName" | "onReorderAt" | "onTrackDrop"> & { isEditing: boolean; page?: FractalPage; path: string };

function FolderSequenceHeader({ child, folders, isEditing, onBeginEditing, onOpenFolder, onOpenPage, onRemoveMissing, onSavePage, page, path, buffer }: Pick<FolderSequenceCardProps, "buffer" | "child" | "folders" | "isEditing" | "onBeginEditing" | "onOpenFolder" | "onOpenPage" | "onRemoveMissing" | "onSavePage" | "page" | "path">) {
  return (
    <header>
      <div>
        <small>{child.kind === "folder" ? "Folder" : child.status === "missing" ? "Missing page" : wordLabel(page?.text ?? "")}</small>
        <h2>{child.kind === "folder" ? folders.find((candidate) => candidate.path === path)?.title || child.name : page?.title?.trim() || child.name}</h2>
        <code>{path}</code>
      </div>
      <FolderSequenceActions buffer={buffer} child={child} isEditing={isEditing} missing={child.status === "missing"} onBeginEditing={onBeginEditing} onOpenFolder={onOpenFolder} onOpenPage={onOpenPage} onRemoveMissing={onRemoveMissing} onSavePage={onSavePage} page={page} path={path} />
    </header>
  );
}

function FolderSequenceBody({ buffer, child, editorOwner, isBusy, isEditing, loadErrors, loadingPaths, onChangeSource, onRevision, onSnapshot, page, pages, path, spellCheck }: Pick<FolderSequenceCardProps, "buffer" | "child" | "editorOwner" | "isBusy" | "isEditing" | "loadErrors" | "loadingPaths" | "onChangeSource" | "onRevision" | "onSnapshot" | "page" | "pages" | "path" | "spellCheck">) {
  return (
    <>
      {child.status === "missing" ? <p className="folder-missing-copy">Fractal kept this place because the item was removed outside the project engine.</p> : null}
      {page && !isEditing ? <p className="folder-page-preview">{page.text.trim() || "This page is empty."}</p> : null}
      {isEditing && loadingPaths.has(path) ? <p className="folder-inline-state">Loading page…</p> : null}
      {isEditing && loadErrors[path] ? <p className="folder-inline-state error">{loadErrors[path]}</p> : null}
      {isEditing && buffer ? (
        <div className="folder-document-editor">
          <InlineFolderEditor buffer={buffer} editorOwner={editorOwner} isBusy={isBusy} pages={pages} spellCheck={spellCheck} viewId={`folder:${path}`} onChangeSource={(source, nativeSection) => onChangeSource(path, source, nativeSection)} onRevision={onRevision} onSnapshot={onSnapshot} />
          {buffer.error ? <p className="folder-inline-state error">{buffer.error}</p> : null}
        </div>
      ) : null}
    </>
  );
}

function FolderSequenceCard(props: FolderSequenceCardProps) {
  return (
    <article className="folder-sequence-card" onDoubleClick={(event) => props.onOpenChild(event, props.child.kind, props.path, props.child.status === "missing", props.isEditing)} title={props.child.status !== "missing" && !props.isEditing ? "Double-click to open" : undefined}>
      <FolderSequenceHeader buffer={props.buffer} child={props.child} folders={props.folders} isEditing={props.isEditing} onBeginEditing={props.onBeginEditing} onOpenFolder={props.onOpenFolder} onOpenPage={props.onOpenPage} onRemoveMissing={props.onRemoveMissing} onSavePage={props.onSavePage} page={props.page} path={props.path} />
      <FolderSequenceBody buffer={props.buffer} child={props.child} editorOwner={props.editorOwner} isBusy={props.isBusy} isEditing={props.isEditing} loadErrors={props.loadErrors} loadingPaths={props.loadingPaths} onChangeSource={props.onChangeSource} onRevision={props.onRevision} onSnapshot={props.onSnapshot} page={props.page} pages={props.pages} path={props.path} spellCheck={props.spellCheck} />
    </article>
  );
}

function FolderSequenceItem(props: FolderSequenceItemProps) {
  const { buffer, child, dropIndex, editingPath, editorOwner, folderPath, folders, index, isBusy, loadErrors, loadingPaths, onBeginEditing, onChangeSource, onDragEnd, onDragStartName, onOpenChild, onOpenFolder, onOpenPage, onRemoveMissing, onReorderAt, onRevision, onSavePage, onSnapshot, onTrackDrop, pages, spellCheck } = props;
  const path = folderChildPath(folderPath, child.name);
  const page = child.kind === "native" ? pages.find((candidate) => candidate.path === path) : undefined;
  const isEditing = path === editingPath;
  const missing = child.status === "missing";

  return (
    <li
      className={`folder-sequence-item ${child.kind}${missing ? " missing" : ""}${isEditing ? " editing" : ""}${dropIndex === index ? " drop-before" : ""}`}
      draggable={!isBusy && !isEditing}
      onDragEnd={onDragEnd}
      onDragOver={(event) => onTrackDrop(event, index)}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(FOLDER_CHILD_MIME, child.name);
        onDragStartName(child.name);
      }}
      onDrop={(event) => { event.preventDefault(); onReorderAt(dropIndex ?? index); }}
    >
      <div className="folder-sequence-spine"><span>{String(index + 1).padStart(2, "0")}</span><i /></div>
      <FolderSequenceCard
        buffer={buffer}
        child={child}
        editorOwner={editorOwner}
        folders={folders}
        isBusy={isBusy}
        isEditing={isEditing}
        loadErrors={loadErrors}
        loadingPaths={loadingPaths}
        onBeginEditing={onBeginEditing}
        onChangeSource={onChangeSource}
        onOpenChild={onOpenChild}
        onOpenFolder={onOpenFolder}
        onOpenPage={onOpenPage}
        onRemoveMissing={onRemoveMissing}
        onSavePage={onSavePage}
        onRevision={onRevision}
        onSnapshot={onSnapshot}
        page={page}
        pages={pages}
        path={path}
        spellCheck={spellCheck}
      />
    </li>
  );
}

function FolderViewHeader({ folder, isBusy, onOpenFolder, onTitleChange, onTitleCommit, projectName, title }: {
  folder: FractalFolder;
  isBusy: boolean;
  onOpenFolder: Props["onOpenFolder"];
  onTitleChange: (title: string) => void;
  onTitleCommit: () => void;
  projectName: string;
  title: string;
}) {
  const nativeCount = folder.children.filter((child) => child.kind === "native" && child.status === "present").length;
  const folderCount = folder.children.filter((child) => child.kind === "folder" && child.status === "present").length;
  return (
    <header className="folder-view-header">
      <div className="folder-view-eyebrow">
        <TreeLocation currentKind="folder" disabled={isBusy} onNavigateFolder={onOpenFolder} onUp={folder.path ? () => onOpenFolder(directParent(folder.path)) : undefined} path={folder.path} projectName={projectName} upTitle={`Go up to ${directParent(folder.path) || "Pages"}`} />
      </div>
      <input
        aria-label="Folder title"
        disabled={isBusy}
        onBlur={onTitleCommit}
        onChange={(event) => onTitleChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") { onTitleChange(folder.title); event.currentTarget.blur(); }
        }}
        value={title}
      />
      <div className="folder-view-summary">
        <span>{nativeCount} {nativeCount === 1 ? "page" : "pages"}</span>
        <span>{folderCount} {folderCount === 1 ? "folder" : "folders"}</span>
        <span>{folder.order ? "Custom order" : "Default order"}</span>
      </div>
    </header>
  );
}

type FolderSequenceProps = FolderSequenceInteractions & {
  addMenu: "top" | "bottom" | "empty" | null;
  buffers: Record<string, DocumentBuffer>;
  dropIndex: number | null;
  editingPath: string | null;
  folder: FractalFolder;
  onBeginCreating: (kind: "page" | "folder") => void;
  onSetAddMenu: (menu: "top" | "bottom" | "empty" | null) => void;
};

function FolderSequence(props: FolderSequenceProps) {
  const { addMenu, buffers, dropIndex, editingPath, editorOwner, folder, folders, isBusy, loadErrors, loadingPaths, onBeginCreating, onBeginEditing, onChangeSource, onDragEnd, onDragStartName, onOpenChild, onOpenFolder, onOpenPage, onRemoveMissing, onReorderAt, onRevision, onSavePage, onSetAddMenu, onSnapshot, onTrackDrop, pages, spellCheck } = props;
  const toggleAddMenu = (menu: "top" | "bottom" | "empty") => onSetAddMenu(addMenu === menu ? null : menu);
  return (
    <ol className="folder-sequence">
      {folder.children.length ? <FolderAddControl isBusy={isBusy} open={addMenu === "top"} placement="top" onCreate={onBeginCreating} onOpen={() => toggleAddMenu("top")} /> : null}
      {!folder.children.length ? <EmptyFolderControl isBusy={isBusy} open={addMenu === "empty"} onCreate={onBeginCreating} onOpen={() => toggleAddMenu("empty")} /> : null}
      {folder.children.map((child, index) => <FolderSequenceItem
        buffer={buffers[folderChildPath(folder.path, child.name)]}
        child={child}
        editorOwner={editorOwner}
        dropIndex={dropIndex}
        editingPath={editingPath}
        folderPath={folder.path}
        folders={folders}
        index={index}
        isBusy={isBusy}
        key={`${child.kind}:${child.name}`}
        loadErrors={loadErrors}
        loadingPaths={loadingPaths}
        onBeginEditing={onBeginEditing}
        onChangeSource={onChangeSource}
        onDragEnd={onDragEnd}
        onDragStartName={onDragStartName}
        onOpenChild={onOpenChild}
        onOpenFolder={onOpenFolder}
        onOpenPage={onOpenPage}
        onRemoveMissing={onRemoveMissing}
        onReorderAt={onReorderAt}
        onSavePage={onSavePage}
        onRevision={onRevision}
        onSnapshot={onSnapshot}
        onTrackDrop={onTrackDrop}
        pages={pages}
        spellCheck={spellCheck}
      />)}
      {dropIndex === folder.children.length ? <li className="folder-sequence-end-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); onReorderAt(folder.children.length); }} /> : null}
      {folder.children.length ? <FolderAddControl isBusy={isBusy} open={addMenu === "bottom"} placement="bottom" onCreate={onBeginCreating} onOpen={() => toggleAddMenu("bottom")} /> : null}
    </ol>
  );
}

function FolderIssues({ issues }: { issues: FractalFolder["issues"] }) {
  if (!issues.length) return null;
  return <section className="folder-issues"><span>Folder issues</span>{issues.map((issue) => <p key={`${issue.name}:${issue.message}`}><strong>{issue.name}</strong>{issue.message}</p>)}</section>;
}

function FolderFindGroup({ group, onOpenPage }: { group: FolderFindGroup; onOpenPage: Props["onOpenPage"] }) {
  return (
    <section>
      <header><strong>{group.title}</strong><code>{group.path || "Pages"}</code></header>
      {group.pages.map((page) => <div className="folder-find-page" key={page.path}><button onClick={() => onOpenPage(page.path)} type="button"><strong>{page.title}</strong><small>{page.matches.length} {page.matches.length === 1 ? "match" : "matches"}</small></button>{page.matches.map((snippet, index) => <p key={`${page.path}:${index}`}>{snippet}</p>)}</div>)}
    </section>
  );
}

function FolderFindDrawer({ folderTitle, findCount, findGroups, findQuery, onChangeQuery, onClose, onOpenPage }: { folderTitle: string; findCount: number; findGroups: FolderFindGroup[]; findQuery: string; onChangeQuery: (query: string) => void; onClose: () => void; onOpenPage: Props["onOpenPage"] }) {
  return (
    <aside aria-label="Find in folder" className="folder-find-drawer">
      <header><div><small>Find in folder</small><strong>{folderTitle}</strong></div><button aria-label="Close find" onClick={onClose} type="button">×</button></header>
      <label><span>Search</span><input autoFocus onChange={(event) => onChangeQuery(event.currentTarget.value)} placeholder="Find text in this folder" value={findQuery} /></label>
      <p className="folder-find-count">{findQuery ? `${findCount} ${findCount === 1 ? "match" : "matches"}` : "Type to search every page in export order."}</p>
      <div className="folder-find-results">
        {findQuery && !findCount ? <p>No matches in this folder.</p> : null}
        {findGroups.map((group) => <FolderFindGroup group={group} key={group.path} onOpenPage={onOpenPage} />)}
      </div>
    </aside>
  );
}

function FolderStatusBar({ borealisOpen, borealisWorkspace, folderWords, folderCharacters, focusMode, isBusy, isFindOpen, onExport, onFind, onToggleBorealis, onToggleFocus, pageCount }: {
  borealisOpen: boolean;
  borealisWorkspace: boolean;
  folderCharacters: number;
  folderWords: number;
  focusMode: boolean;
  isBusy: boolean;
  isFindOpen: boolean;
  onExport: () => void;
  onFind: () => void;
  onToggleBorealis: () => void;
  onToggleFocus: () => void;
  pageCount: number;
}) {
  return (
    <footer className="document-status-bar folder-status-bar">
      <div><span>{folderWords.toLocaleString()} words</span><span>{folderCharacters.toLocaleString()} characters</span><span>{pageCount.toLocaleString()} pages</span></div>
      <div className="document-status-actions"><button aria-pressed={isFindOpen} onClick={onFind} type="button">Find</button><button disabled={isBusy} onClick={onExport} type="button">Export</button><BorealisTrigger isOpen={borealisOpen} isWorkspace={borealisWorkspace} onClick={onToggleBorealis} /><button aria-pressed={focusMode} onClick={onToggleFocus} type="button">{focusMode ? "Exit focus" : "Focus"}</button></div>
    </footer>
  );
}

function FolderCreateDialog({ createInputRef, createKind, createName, folderTitle, onChangeName, onClose, onSubmit }: {
  createInputRef: RefObject<HTMLInputElement | null>;
  createKind: "page" | "folder";
  createName: string;
  folderTitle: string;
  onChangeName: (name: string) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <form aria-labelledby="folder-create-title" aria-modal="true" className="create-page-dialog" onSubmit={onSubmit} role="dialog">
        <div className="dialog-header"><p className="dialog-kicker">Inside {folderTitle}</p><h2 id="folder-create-title">Create {createKind}</h2></div>
        <label className="dialog-field"><span>{createKind === "page" ? "Title" : "Name"}</span><input onChange={(event) => onChangeName(event.currentTarget.value)} ref={createInputRef} value={createName} /></label>
        <p className="dialog-note">{createKind === "page" ? "Fractal derives the filename from the title." : "The folder will appear in this sequence."}</p>
        <div className="dialog-actions"><button className="ghost-action" onClick={onClose} type="button">Cancel</button><button className="primary-action" disabled={!createName.trim()} type="submit">Create</button></div>
      </form>
    </div>
  );
}

function useFolderViewState(folder: FractalFolder) {
  const viewRef = useRef<HTMLElement>(null);
  const [title, setTitle] = useState(folder.title);
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
  return {
    addMenu,
    createInputRef,
    createKind,
    createName,
    draggedName,
    dropIndex,
    editingPath,
    findQuery,
    isExportOpen,
    isFindOpen,
    setAddMenu,
    setCreateKind,
    setCreateName,
    setDraggedName,
    setDropIndex,
    setEditingPath,
    setFindQuery,
    setIsExportOpen,
    setIsFindOpen,
    setTitle,
    title,
    viewRef
  };
}

function useFolderViewEffects(props: Props, state: ReturnType<typeof useFolderViewState>) {
  const { addMenu, createInputRef, createKind, setAddMenu, setEditingPath, setIsFindOpen, setTitle, viewRef } = state;
  useEffect(() => setTitle(props.folder.title), [props.folder.path, props.folder.title, setTitle]);
  useEffect(() => setEditingPath(null), [props.folder.path, setEditingPath]);
  useEffect(() => {
    const openFind = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey || event.key.toLowerCase() !== "f") return;
      if (!viewRef.current?.closest(".editor-tab-panel.active")) return;
      event.preventDefault();
      setIsFindOpen(true);
    };
    window.addEventListener("keydown", openFind);
    return () => window.removeEventListener("keydown", openFind);
  }, [setIsFindOpen, viewRef]);
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
  }, [addMenu, setAddMenu]);
  useEffect(() => {
    if (!createKind) return;
    const frame = requestAnimationFrame(() => { createInputRef.current?.focus(); createInputRef.current?.select(); });
    return () => cancelAnimationFrame(frame);
  }, [createKind, createInputRef]);
}

function useFolderViewData(props: Props, state: ReturnType<typeof useFolderViewState>) {
  const exportTree = useMemo(() => buildFolderExportTree(props.folder, props.folders, props.pages), [props.folder, props.folders, props.pages]);
  const orderedPagePaths = useMemo(() => {
    const paths: string[] = [];
    const visit = (nodes: FolderExportNode[]) => nodes.forEach((node) => node.kind === "page" ? paths.push(node.projectPath) : visit(node.children));
    visit(exportTree);
    return paths;
  }, [exportTree]);
  const scopedPages = orderedPagePaths.map((path) => props.pages.find((page) => page.path === path)).filter((page): page is FractalPage => Boolean(page));
  const findGroups = useMemo(() => buildFolderFindGroups(exportTree, props.pages, state.findQuery, props.folder.title, props.folder.path), [exportTree, props.folder.path, props.folder.title, props.pages, state.findQuery]);
  return {
    exportTree,
    findCount: findGroups.reduce((total, group) => total + group.pages.reduce((subtotal, page) => subtotal + page.matches.length, 0), 0),
    findGroups,
    folderCharacters: scopedPages.reduce((total, page) => total + page.text.length, 0),
    folderWords: scopedPages.reduce((total, page) => total + (page.text.trim() ? page.text.trim().split(/\s+/u).length : 0), 0),
    orderedNames: props.folder.children.map((child) => child.name),
    scopedPages
  };
}

function useFolderViewActions(props: Props, state: ReturnType<typeof useFolderViewState>, data: ReturnType<typeof useFolderViewData>) {
  const { createKind, createName, draggedName, editingPath, setAddMenu, setCreateKind, setCreateName, setDraggedName, setDropIndex, setEditingPath, setTitle, title } = state;
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
    const sourceIndex = data.orderedNames.indexOf(draggedName);
    if (sourceIndex < 0) return;
    const without = data.orderedNames.filter((name) => name !== draggedName);
    const insertion = Math.max(0, Math.min(index - (sourceIndex < index ? 1 : 0), without.length));
    const next = [...without.slice(0, insertion), draggedName, ...without.slice(insertion)];
    setDraggedName(null);
    setDropIndex(null);
    if (next.some((name, position) => name !== data.orderedNames[position])) props.onReorder(next);
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

  return { beginCreating, beginEditing, commitTitle, openChild, reorderAt, submitCreate, trackDrop };
}

function FolderView(props: Props) {
  const state = useFolderViewState(props.folder);
  useFolderViewEffects(props, state);
  const data = useFolderViewData(props, state);
  const actions = useFolderViewActions(props, state, data);
  const { addMenu, createInputRef, createKind, createName, dropIndex, editingPath, findQuery, isExportOpen, isFindOpen, setAddMenu, setCreateKind, setCreateName, setDraggedName, setDropIndex, setFindQuery, setIsExportOpen, setIsFindOpen, setTitle, title, viewRef } = state;
  const { findCount, findGroups, folderCharacters, folderWords, scopedPages } = data;
  const { beginCreating, beginEditing, commitTitle, openChild, reorderAt, submitCreate, trackDrop } = actions;

  return (
    <section className="folder-view-shell" aria-label={`Folder ${props.folder.title}`} ref={viewRef}>
      <div aria-label={`Folder ${props.folder.title}`} className="folder-view">
        <FolderViewHeader folder={props.folder} isBusy={props.isBusy} onOpenFolder={props.onOpenFolder} onTitleChange={setTitle} onTitleCommit={commitTitle} projectName={props.projectName} title={title} />
        <div className="folder-manuscript">
          <FolderSequence
            addMenu={addMenu}
            buffers={props.buffers}
            dropIndex={dropIndex}
            editorOwner={props.editorOwner}
            editingPath={editingPath}
            folder={props.folder}
            folders={props.folders}
            isBusy={props.isBusy}
            loadErrors={props.loadErrors}
            loadingPaths={props.loadingPaths}
            onBeginCreating={beginCreating}
            onBeginEditing={(path) => { void beginEditing(path); }}
            onChangeSource={props.onChangeSource}
            onDragEnd={() => { setDraggedName(null); setDropIndex(null); }}
            onDragStartName={setDraggedName}
            onOpenChild={openChild}
            onOpenFolder={props.onOpenFolder}
            onOpenPage={props.onOpenPage}
            onRemoveMissing={props.onRemoveMissing}
            onReorderAt={reorderAt}
            onSavePage={props.onSavePage}
            onSetAddMenu={setAddMenu}
            onRevision={props.onRevision}
            onSnapshot={props.onSnapshot}
            onTrackDrop={trackDrop}
            pages={props.pages}
            spellCheck={props.spellCheck}
          />
          <FolderIssues issues={props.folder.issues} />
        </div>
      </div>
      {isFindOpen ? <FolderFindDrawer folderTitle={props.folder.title} findCount={findCount} findGroups={findGroups} findQuery={findQuery} onChangeQuery={setFindQuery} onClose={() => setIsFindOpen(false)} onOpenPage={props.onOpenPage} /> : null}
      <FolderStatusBar borealisOpen={props.borealisOpen} borealisWorkspace={props.borealisWorkspace} folderCharacters={folderCharacters} folderWords={folderWords} focusMode={props.focusMode} isBusy={props.isBusy} isFindOpen={isFindOpen} onExport={() => setIsExportOpen(true)} onFind={() => setIsFindOpen((open) => !open)} onToggleBorealis={props.onToggleBorealis} onToggleFocus={props.onToggleFocus} pageCount={scopedPages.length} />
      {isExportOpen ? <FolderExportDialog folder={props.folder} folders={props.folders} pages={props.pages} onClose={() => setIsExportOpen(false)} onExport={props.onExport} /> : null}
      {createKind ? <FolderCreateDialog createInputRef={createInputRef} createKind={createKind} createName={createName} folderTitle={props.folder.title} onChangeName={setCreateName} onClose={() => setCreateKind(null)} onSubmit={submitCreate} /> : null}
    </section>
  );
}

export default FolderView;
