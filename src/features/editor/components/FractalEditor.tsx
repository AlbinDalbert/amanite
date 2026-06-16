import { $generateHtmlFromNodes, $generateNodesFromDOM } from "@lexical/html";
import { LinkNode } from "@lexical/link";
import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListItemNode,
  ListNode
} from "@lexical/list";
import { AutoFocusPlugin } from "@lexical/react/LexicalAutoFocusPlugin";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type EditorState,
  type LexicalEditor as LexicalEditorInstance,
  type TextFormatType
} from "lexical";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent
} from "react";
import {
  $createHeadingNode,
  $createQuoteNode,
  HeadingNode,
  QuoteNode,
  type HeadingTagType
} from "@lexical/rich-text";
import type {
  FractalGraphPageLink,
  FractalNote,
  FractalPageLink
} from "@/lib/fractal/types";

type FractalEditorProps = {
  backlinks: FractalGraphPageLink[];
  bodyHtml: string;
  isBusy: boolean;
  isDirty: boolean;
  links: FractalPageLink[];
  notes: FractalNote[];
  outlinks: FractalGraphPageLink[];
  pagePath: string;
  summary?: string | null;
  tags: string[];
  title: string;
  onAddNote: (trigger: string, content: string) => void;
  onDeleteNote: (note: FractalNote) => void;
  onChangeBodyHtml: (bodyHtml: string) => void;
  onChangeSummary: (summary: string) => void;
  onChangeTags: (tags: string[]) => void;
  onChangeTitle: (title: string) => void;
  onNavigatePage: (pagePath: string) => void;
  onSave: () => void;
  onUpdateNote: (note: FractalNote, content: string) => void;
};

type ToolbarButtonProps = {
  isActive?: boolean;
  label: string;
  title: string;
  onClick: () => void;
};

type NoteContextMenuState = {
  trigger: string;
  x: number;
  y: number;
};

const AMANITE_HTML_LOAD_TAG = "amanite-html-load";

const lexicalTheme = {
  heading: {
    h2: "rich-heading rich-heading-two",
    h3: "rich-heading rich-heading-three"
  },
  link: "rich-link",
  list: {
    listitem: "rich-list-item",
    nested: {
      listitem: "rich-list-item nested"
    },
    ol: "rich-list ordered",
    ul: "rich-list unordered"
  },
  paragraph: "rich-paragraph",
  quote: "rich-quote",
  text: {
    bold: "rich-text-bold",
    italic: "rich-text-italic",
    strikethrough: "rich-text-strike",
    underline: "rich-text-underline"
  }
};

function importHtmlIntoEditor(editor: LexicalEditorInstance, html: string) {
  const parser = new DOMParser();
  const dom = parser.parseFromString(html || "<p></p>", "text/html");
  const nodes = $generateNodesFromDOM(editor, dom.body);
  const root = $getRoot();

  root.clear();

  if (nodes.length > 0) {
    root.append(...nodes);
  }

  if (root.getChildrenSize() === 0) {
    root.append($createParagraphNode());
  }
}

function tagsFromDraft(value: string) {
  const seenTags = new Set<string>();
  const tags: string[] = [];

  for (const part of value.split(/[,\n]/)) {
    const tag = part.trim();
    const key = tag.toLowerCase();

    if (tag && !seenTags.has(key)) {
      seenTags.add(key);
      tags.push(tag);
    }
  }

  return tags;
}

function normalizeInternalPageHref(href: string, currentPagePath: string) {
  let pageHref = href.trim();

  if (/^https?:\/\//i.test(pageHref)) {
    try {
      const url = new URL(pageHref);

      if (url.hostname && !url.hostname.includes(".") && url.hostname !== "localhost") {
        pageHref = `${url.hostname}${url.pathname}${url.search}${url.hash}`;
      }
    } catch {
      return null;
    }
  }

  if (!pageHref || /^(?:[a-z][a-z0-9+.-]*:|#)/i.test(pageHref)) {
    return null;
  }

  const hrefPath = pageHref.split("#", 1)[0].split("?", 1)[0];
  if (!hrefPath) {
    return null;
  }

  const currentFolder = currentPagePath.split("/").filter(Boolean).slice(0, -1);
  const hrefParts = hrefPath.replaceAll("\\", "/").split("/").filter(Boolean);
  const parts = pageHref.startsWith("/") || hrefParts[0] === "pages" ? [] : [...currentFolder];

  for (const part of hrefParts) {
    if (part === "." || part === "pages") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  if (parts.length === 0) {
    return null;
  }

  if (!parts.at(-1)?.includes(".")) {
    parts[parts.length - 1] = `${parts.at(-1)}.html`;
  }

  return parts.join("/");
}

function ToolbarButton({ isActive = false, label, title, onClick }: ToolbarButtonProps) {
  return (
    <button
      aria-pressed={isActive}
      className={isActive ? "rich-toolbar-button active" : "rich-toolbar-button"}
      onClick={onClick}
      title={title}
      type="button"
    >
      {label}
    </button>
  );
}

function EditorToolbar() {
  const [editor] = useLexicalComposerContext();
  const [activeFormats, setActiveFormats] = useState<Set<TextFormatType>>(() => new Set());

  const updateToolbar = useCallback(() => {
    const selection = $getSelection();
    const nextFormats = new Set<TextFormatType>();

    if ($isRangeSelection(selection)) {
      for (const format of ["bold", "italic", "underline", "strikethrough"] as const) {
        if (selection.hasFormat(format)) {
          nextFormats.add(format);
        }
      }
    }

    setActiveFormats(nextFormats);
  }, []);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(({ editorState }) => {
          editorState.read(updateToolbar, { editor });
        }),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            updateToolbar();
            return false;
          },
          COMMAND_PRIORITY_LOW
        )
      ),
    [editor, updateToolbar]
  );

  function formatText(format: TextFormatType) {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  }

  function formatBlock(kind: "paragraph" | "quote" | HeadingTagType) {
    editor.update(() => {
      const selection = $getSelection();

      if (!$isRangeSelection(selection)) {
        return;
      }

      if (kind === "paragraph") {
        $setBlocksType(selection, () => $createParagraphNode());
      } else if (kind === "quote") {
        $setBlocksType(selection, () => $createQuoteNode());
      } else {
        $setBlocksType(selection, () => $createHeadingNode(kind));
      }
    });
  }

  return (
    <div className="rich-toolbar" aria-label="Text formatting">
      <div className="rich-toolbar-group" role="group" aria-label="Inline formatting">
        <ToolbarButton
          isActive={activeFormats.has("bold")}
          label="B"
          title="Bold"
          onClick={() => formatText("bold")}
        />
        <ToolbarButton
          isActive={activeFormats.has("italic")}
          label="I"
          title="Italic"
          onClick={() => formatText("italic")}
        />
        <ToolbarButton
          isActive={activeFormats.has("underline")}
          label="U"
          title="Underline"
          onClick={() => formatText("underline")}
        />
        <ToolbarButton
          isActive={activeFormats.has("strikethrough")}
          label="S"
          title="Strikethrough"
          onClick={() => formatText("strikethrough")}
        />
      </div>

      <div className="rich-toolbar-group" role="group" aria-label="Blocks">
        <ToolbarButton label="P" title="Paragraph" onClick={() => formatBlock("paragraph")} />
        <ToolbarButton label="H2" title="Heading 2" onClick={() => formatBlock("h2")} />
        <ToolbarButton label="H3" title="Heading 3" onClick={() => formatBlock("h3")} />
        <ToolbarButton label="Q" title="Quote" onClick={() => formatBlock("quote")} />
      </div>

      <div className="rich-toolbar-group" role="group" aria-label="Lists">
        <ToolbarButton
          label="•"
          title="Bulleted list"
          onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)}
        />
        <ToolbarButton
          label="1."
          title="Numbered list"
          onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)}
        />
      </div>
    </div>
  );
}

function HtmlBridgePlugin({
  bodyHtml,
  pagePath,
  onChangeBodyHtml
}: {
  bodyHtml: string;
  pagePath: string;
  onChangeBodyHtml: (bodyHtml: string) => void;
}) {
  const [editor] = useLexicalComposerContext();
  const bodyHtmlForLoadedPage = useMemo(() => bodyHtml, [pagePath]);

  useEffect(() => {
    editor.update(() => importHtmlIntoEditor(editor, bodyHtmlForLoadedPage), {
      tag: AMANITE_HTML_LOAD_TAG
    });
  }, [bodyHtmlForLoadedPage, editor]);

  function handleChange(
    editorState: EditorState,
    lexicalEditor: LexicalEditorInstance,
    tags: Set<string>
  ) {
    if (tags.has(AMANITE_HTML_LOAD_TAG)) {
      return;
    }

    const nextBodyHtml = editorState.read(
      () => $generateHtmlFromNodes(lexicalEditor, null),
      { editor: lexicalEditor }
    );

    onChangeBodyHtml(nextBodyHtml);
  }

  return (
    <OnChangePlugin
      ignoreHistoryMergeTagChange
      ignoreSelectionChange
      onChange={handleChange}
    />
  );
}

function InspectorSection({
  emptyLabel,
  items,
  title
}: {
  emptyLabel: string;
  items: string[];
  title: string;
}) {
  return (
    <section className="fractal-inspector-section">
      <h3>{title}</h3>
      {items.length > 0 ? (
        <ul>
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p>{emptyLabel}</p>
      )}
    </section>
  );
}

function FractalEditor({
  backlinks,
  bodyHtml,
  isBusy,
  isDirty,
  links,
  notes,
  outlinks,
  pagePath,
  summary,
  tags,
  title,
  onAddNote,
  onDeleteNote,
  onChangeBodyHtml,
  onChangeSummary,
  onChangeTags,
  onChangeTitle,
  onNavigatePage,
  onSave,
  onUpdateNote
}: FractalEditorProps) {
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteMenu, setNoteMenu] = useState<NoteContextMenuState | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const tagInputRef = useRef<HTMLInputElement>(null);
  const editorConfig = useMemo(
    () => ({
      namespace: `amanite-${pagePath}`,
      nodes: [HeadingNode, LinkNode, ListItemNode, ListNode, QuoteNode],
      onError(error: Error) {
        throw error;
      },
      theme: lexicalTheme
    }),
    [pagePath]
  );

  useEffect(() => {
    setEditingNoteId(null);
    setIsAddingTag(false);
    setIsInspectorOpen(false);
    setNoteDraft("");
    setTagDraft("");
    setNoteMenu(null);
  }, [pagePath]);

  useEffect(() => {
    if (isAddingTag) {
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }, [isAddingTag]);

  useEffect(() => {
    if (!noteMenu) {
      return;
    }

    function closeMenu() {
      setNoteMenu(null);
    }

    function closeOnEscape(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        closeMenu();
      }
    }

    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [noteMenu]);

  function commitTagDraft() {
    const nextTags = tagsFromDraft(tagDraft);
    const nextTag = nextTags[0];

    if (nextTag && !tags.some((tag) => tag.toLowerCase() === nextTag.toLowerCase())) {
      onChangeTags([...tags, nextTag]);
    }

    setTagDraft("");
    setIsAddingTag(false);
  }

  function removeTag(tagToRemove: string) {
    onChangeTags(tags.filter((tag) => tag !== tagToRemove));
  }

  function handleTagInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      commitTagDraft();
      return;
    }

    if (event.key === "Escape") {
      setTagDraft("");
      setIsAddingTag(false);
    }
  }

  function handleEditorClick(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");

    if (!anchor) {
      return;
    }

    const href = anchor.getAttribute("href");
    if (!href) {
      return;
    }

    if (href.startsWith("#")) {
      const noteId = href.slice(1);
      const noteElement = Array.from(document.querySelectorAll<HTMLElement>("[data-note-id]")).find(
        (element) => element.dataset.noteId === noteId
      );

      if (noteElement) {
        event.preventDefault();
        noteElement.scrollIntoView({ block: "center", behavior: "smooth" });
      }

      return;
    }

    const linkText = anchor.textContent?.trim() ?? "";
    const nextPagePath =
      normalizeInternalPageHref(href, pagePath) ??
      outlinks.find((link) => link.text === linkText)?.page ??
      null;

    if (nextPagePath) {
      event.preventDefault();
      onNavigatePage(nextPagePath);
    }
  }

  function handleEditorContextMenu(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;

    if (!target?.closest(".rich-content-editable")) {
      return;
    }

    const selectedText = window.getSelection()?.toString().replace(/\s+/g, " ").trim() ?? "";
    if (!selectedText) {
      return;
    }

    event.preventDefault();
    setNoteMenu({
      trigger: selectedText,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 208)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 96))
    });
  }

  function handleAddNoteFromMenu() {
    if (!noteMenu) {
      return;
    }

    onAddNote(noteMenu.trigger, "");
    setNoteMenu(null);
  }

  function startEditingNote(note: FractalNote) {
    setEditingNoteId(note.id);
    setNoteDraft(note.text);
  }

  function cancelEditingNote() {
    setEditingNoteId(null);
    setNoteDraft("");
  }

  function commitNoteEdit(note: FractalNote) {
    onUpdateNote(note, noteDraft);
    cancelEditingNote();
  }

  function handleNoteDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, note: FractalNote) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitNoteEdit(note);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelEditingNote();
    }
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      onSave();
    }
  }

  const linkItems = links.map((link) => `${link.text} -> ${link.href}`);
  const noteItems = notes.map((note) => `${note.label}: ${note.text || note.id}`);
  const backlinkItems = backlinks.map((link) => `${link.text} <- ${link.page}`);
  const outlinkItems = outlinks.map((link) => `${link.text} -> ${link.page}`);

  return (
    <div
      className={
        isInspectorOpen
          ? "fractal-editor rich-editor inspector-open"
          : "fractal-editor rich-editor"
      }
      onClickCapture={handleEditorClick}
      onContextMenu={handleEditorContextMenu}
      onKeyDown={handleEditorKeyDown}
    >
      <section className="rich-document-shell" aria-label="Fractal rich editor">
        <LexicalComposer initialConfig={editorConfig} key={pagePath}>
          <header className="rich-editor-header">
            <EditorToolbar />
          </header>

          <button
            className={
              isInspectorOpen
                ? "editor-inspector-toggle floating active"
                : "editor-inspector-toggle floating"
            }
            onClick={() => setIsInspectorOpen((current) => !current)}
            type="button"
          >
            {isInspectorOpen ? "Hide context" : "Inspect"}
          </button>

          <article className="rich-page-canvas">
            <div className="rich-page-column">
              <div className="rich-page-meta">
                <span className="editor-page-path" title={pagePath}>
                  {pagePath}
                </span>
              </div>

              <textarea
                aria-label={`Title for ${pagePath}`}
                className="rich-title-input"
                onChange={(event) => onChangeTitle(event.currentTarget.value)}
                placeholder="Untitled"
                rows={1}
                value={title}
              />

              <div className="rich-metadata-editor">
                <textarea
                  aria-label={`Summary for ${pagePath}`}
                  className="rich-summary-input"
                  onChange={(event) => onChangeSummary(event.currentTarget.value)}
                  placeholder="Add a short page summary..."
                  rows={2}
                  value={summary ?? ""}
                />

                <div className="rich-tag-row" aria-label="Page tags">
                  {tags.map((tag) => (
                    <span className="rich-tag" key={tag}>
                      <span>{tag}</span>
                      <button
                        aria-label={`Remove ${tag} tag`}
                        className="rich-tag-remove"
                        onClick={() => removeTag(tag)}
                        type="button"
                      >
                        ×
                      </button>
                    </span>
                  ))}

                  {isAddingTag ? (
                    <input
                      aria-label="New tag"
                      className="rich-tag rich-tag-input"
                      onBlur={commitTagDraft}
                      onChange={(event) => setTagDraft(event.currentTarget.value)}
                      onKeyDown={handleTagInputKeyDown}
                      placeholder="tag"
                      ref={tagInputRef}
                      value={tagDraft}
                    />
                  ) : (
                    <button
                      aria-label="Add tag"
                      className="rich-tag rich-tag-add"
                      onClick={() => setIsAddingTag(true)}
                      type="button"
                    >
                      +
                    </button>
                  )}
                </div>
              </div>

              <div className="rich-body-frame">
                <RichTextPlugin
                  contentEditable={
                    <ContentEditable
                      aria-label={`Body for ${pagePath}`}
                      className="rich-content-editable"
                    />
                  }
                  placeholder={<div className="rich-placeholder">Write this Fractal page...</div>}
                  ErrorBoundary={LexicalErrorBoundary}
                />
                <HistoryPlugin />
                <ListPlugin />
                <LinkPlugin />
                <AutoFocusPlugin />
                <HtmlBridgePlugin
                  bodyHtml={bodyHtml}
                  pagePath={pagePath}
                  onChangeBodyHtml={onChangeBodyHtml}
                />
              </div>

              <section className="rich-notes-ledger" aria-label="Internal notes">
                <div className="rich-notes-header">
                  <span>Internal notes</span>
                  <small>{notes.length}</small>
                </div>
                {notes.length > 0 ? (
                  <ol className="rich-note-list">
                    {notes.map((note) => {
                      const isEditingNote = editingNoteId === note.id;

                      return (
                        <li
                          className={isEditingNote ? "rich-note-card editing" : "rich-note-card"}
                          data-note-id={note.id}
                          id={note.id}
                          key={note.id}
                        >
                          <div className="rich-note-card-header">
                            <strong>{note.label}</strong>
                            <div className="rich-note-actions">
                              {isEditingNote ? (
                                <>
                                  <button
                                    disabled={isBusy}
                                    onClick={() => commitNoteEdit(note)}
                                    type="button"
                                  >
                                    Save
                                  </button>
                                  <button onClick={cancelEditingNote} type="button">
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <>
                                  <button
                                    disabled={isBusy}
                                    onClick={() => startEditingNote(note)}
                                    type="button"
                                  >
                                    Edit
                                  </button>
                                  <button
                                    className="danger"
                                    disabled={isBusy}
                                    onClick={() => onDeleteNote(note)}
                                    type="button"
                                  >
                                    Delete
                                  </button>
                                </>
                              )}
                            </div>
                          </div>

                          {isEditingNote ? (
                            <textarea
                              aria-label={`Note body for ${note.label}`}
                              className="rich-note-editor"
                              onChange={(event) => setNoteDraft(event.currentTarget.value)}
                              onKeyDown={(event) => handleNoteDraftKeyDown(event, note)}
                              placeholder="Write the note body..."
                              rows={3}
                              value={noteDraft}
                            />
                          ) : (
                            <p>{note.text || "No note body yet."}</p>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="rich-notes-empty">
                    Select text in the body, right-click, then add a note.
                  </p>
                )}
              </section>
            </div>
          </article>
        </LexicalComposer>
      </section>

      {noteMenu ? (
        <div
          className="editor-context-menu"
          role="menu"
          style={{ left: noteMenu.x, top: noteMenu.y }}
        >
          <p title={noteMenu.trigger}>{noteMenu.trigger}</p>
          <button onClick={handleAddNoteFromMenu} role="menuitem" type="button">
            Add note
          </button>
        </div>
      ) : null}

      <aside className="fractal-inspector" aria-label="Fractal page context">
        <section className="fractal-inspector-card">
          <p className="fractal-inspector-kicker">Context</p>
          <dl className="fractal-stats">
            <div>
              <dt>Links</dt>
              <dd>{links.length}</dd>
            </div>
            <div>
              <dt>Backlinks</dt>
              <dd>{backlinks.length}</dd>
            </div>
            <div>
              <dt>Notes</dt>
              <dd>{notes.length}</dd>
            </div>
          </dl>
        </section>

        <InspectorSection
          emptyLabel="No outgoing page links."
          items={outlinkItems}
          title="Outlinks"
        />
        <InspectorSection
          emptyLabel="No backlinks yet."
          items={backlinkItems}
          title="Backlinks"
        />
        <InspectorSection
          emptyLabel="No inline links."
          items={linkItems}
          title="HTML Links"
        />
        <InspectorSection
          emptyLabel="No Fractal notes."
          items={noteItems}
          title="Notes"
        />
      </aside>
    </div>
  );
}

export default FractalEditor;
