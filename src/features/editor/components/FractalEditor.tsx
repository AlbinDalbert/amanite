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
  FractalPage,
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
  pages: FractalPage[];
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
  popoverX: number;
  popoverY: number;
  x: number;
  y: number;
};

type NotePopoverState =
  | {
      kind: "note-preview";
      note: FractalNote;
      x: number;
      y: number;
    }
  | {
      kind: "note-detail";
      note: FractalNote;
      x: number;
      y: number;
    }
  | {
      kind: "page-preview";
      page: FractalPage;
      x: number;
      y: number;
    }
  | {
      draft: string;
      kind: "create";
      trigger: string;
      x: number;
      y: number;
    }
  | {
      draft: string;
      kind: "edit";
      note: FractalNote;
      x: number;
      y: number;
    };

const AMANITE_HTML_LOAD_TAG = "amanite-html-load";
const NOTE_CONTEXT_MENU_WIDTH = 208;
const NOTE_CONTEXT_MENU_HEIGHT = 96;
const NOTE_POPOVER_WIDTH = 318;
const NOTE_PREVIEW_POPOVER_HEIGHT = 148;
const NOTE_DETAIL_POPOVER_HEIGHT = 242;
const NOTE_EDITOR_POPOVER_HEIGHT = 238;
const NOTE_PREVIEW_WORD_LIMIT = 26;
const NOTE_PREVIEW_CHARACTER_LIMIT = 190;
const PAGE_PREVIEW_WORD_LIMIT = 34;
const PAGE_PREVIEW_CHARACTER_LIMIT = 240;

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

function safeDecodePath(value: string) {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function urlBackToProjectHref(url: URL) {
  const sameAppHost =
    url.hostname &&
    window.location.hostname &&
    url.hostname === window.location.hostname &&
    (url.protocol === window.location.protocol || url.hostname.endsWith(".localhost"));
  const tauriAssetHost = url.protocol === "tauri:" && url.hostname === "localhost";

  if (sameAppHost || tauriAssetHost) {
    return safeDecodePath(url.pathname);
  }

  const hostLooksLikeRelativePath =
    Boolean(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.port &&
    (!url.hostname.includes(".") || /\.html?$/i.test(url.hostname));

  if (!hostLooksLikeRelativePath) {
    return null;
  }

  const urlPath = url.pathname === "/" ? "" : url.pathname;
  return safeDecodePath(`${url.hostname}${urlPath}`);
}

function normalizeInternalPageHref(href: string, currentPagePath: string) {
  let pageHref = href.trim();

  if (/^(?:https?|tauri):\/\//i.test(pageHref)) {
    try {
      const normalizedUrlHref = urlBackToProjectHref(new URL(pageHref));

      if (!normalizedUrlHref) {
        return null;
      }

      pageHref = normalizedUrlHref;
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
  const firstMeaningfulPart = hrefParts.find((part) => part !== ".");
  const parts =
    pageHref.startsWith("/") || firstMeaningfulPart === "pages" ? [] : [...currentFolder];

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

function compactText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateText(value: string, wordLimit: number, characterLimit: number) {
  const text = compactText(value);

  if (!text) {
    return "";
  }

  const words = text.split(" ");
  if (words.length > wordLimit) {
    return `${words.slice(0, wordLimit).join(" ")}…`;
  }

  if (text.length > characterLimit) {
    return `${text.slice(0, characterLimit - 1).trim()}…`;
  }

  return text;
}

function truncateNotePreview(value: string) {
  return (
    truncateText(value, NOTE_PREVIEW_WORD_LIMIT, NOTE_PREVIEW_CHARACTER_LIMIT) ||
    "No note body yet."
  );
}

function pagePreviewText(page: FractalPage) {
  return (
    truncateText(page.summary ?? "", PAGE_PREVIEW_WORD_LIMIT, PAGE_PREVIEW_CHARACTER_LIMIT) ||
    truncateText(page.bodyPreview ?? "", PAGE_PREVIEW_WORD_LIMIT, PAGE_PREVIEW_CHARACTER_LIMIT) ||
    "No summary yet."
  );
}

function fileNameFromPath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function stripHtmlExtension(value: string) {
  return value.replace(/\.html?$/i, "");
}

function comparisonKey(value: string) {
  return compactText(value).toLowerCase();
}

function slugComparisonKey(value: string) {
  return comparisonKey(value)
    .replace(/\.html?$/i, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueInspectorItems<T>(
  items: T[],
  keyForItem: (item: T) => string,
  labelForItem: (item: T) => string
) {
  const seenItems = new Set<string>();
  const uniqueItems: string[] = [];

  for (const item of items) {
    const key = comparisonKey(keyForItem(item));

    if (!key || seenItems.has(key)) {
      continue;
    }

    seenItems.add(key);
    uniqueItems.push(labelForItem(item));
  }

  return uniqueItems;
}

function isPageLinkHref(href: string) {
  const trimmedHref = href.trim();

  return (
    Boolean(trimmedHref) &&
    !trimmedHref.startsWith("#") &&
    (!/^[a-z][a-z0-9+.-]*:/i.test(trimmedHref) || /^(?:https?|tauri):\/\//i.test(trimmedHref))
  );
}

function pagePathCandidatesForAnchor(
  anchor: HTMLAnchorElement,
  currentPagePath: string,
  outlinks: FractalGraphPageLink[]
) {
  const href = anchor.getAttribute("href") ?? "";
  const linkTextKey = comparisonKey(anchor.textContent ?? "");
  const normalizedHref = normalizeInternalPageHref(href, currentPagePath);
  const candidates: string[] = [];

  if (normalizedHref) {
    candidates.push(normalizedHref);
  }

  for (const outlink of outlinks) {
    if (
      (normalizedHref && outlink.page === normalizedHref) ||
      (normalizedHref &&
        fileNameFromPath(outlink.page).toLowerCase() ===
          fileNameFromPath(normalizedHref).toLowerCase()) ||
      (linkTextKey && comparisonKey(outlink.text) === linkTextKey)
    ) {
      candidates.push(outlink.page);
    }
  }

  return candidates;
}

function resolvePageForAnchor(
  anchor: HTMLAnchorElement,
  currentPagePath: string,
  pages: FractalPage[],
  outlinks: FractalGraphPageLink[]
) {
  const href = anchor.getAttribute("href") ?? "";

  if (!isPageLinkHref(href)) {
    return null;
  }

  const candidates = pagePathCandidatesForAnchor(anchor, currentPagePath, outlinks);
  const byExactPath = new Map(pages.map((page) => [page.path, page]));

  for (const candidate of candidates) {
    const page = byExactPath.get(candidate);

    if (page) {
      return page;
    }
  }

  const candidateFileNames = candidates.map((candidate) =>
    fileNameFromPath(candidate).toLowerCase()
  );
  const fileNameMatches = pages.filter((page) =>
    candidateFileNames.includes(fileNameFromPath(page.path).toLowerCase())
  );

  if (fileNameMatches.length === 1) {
    return fileNameMatches[0];
  }

  const linkText = anchor.textContent ?? "";
  const linkTextKey = comparisonKey(linkText);
  const linkSlugKey = slugComparisonKey(linkText);
  const textMatches = pages.filter((page) => {
    const pageFileStem = stripHtmlExtension(fileNameFromPath(page.path)).toLowerCase();

    return (
      comparisonKey(page.name) === linkTextKey ||
      slugComparisonKey(page.name) === linkSlugKey ||
      pageFileStem === linkSlugKey
    );
  });

  return textMatches.length === 1 ? textMatches[0] : null;
}

function resolvePagePathForAnchor(
  anchor: HTMLAnchorElement,
  currentPagePath: string,
  pages: FractalPage[],
  outlinks: FractalGraphPageLink[]
) {
  const page = resolvePageForAnchor(anchor, currentPagePath, pages, outlinks);

  if (page) {
    return page.path;
  }

  return normalizeInternalPageHref(anchor.getAttribute("href") ?? "", currentPagePath);
}

function positionFloatingPopover(
  rect: Pick<DOMRect, "bottom" | "height" | "left" | "top" | "width">,
  height: number
) {
  const x = Math.max(
    8,
    Math.min(
      rect.left + rect.width / 2 - NOTE_POPOVER_WIDTH / 2,
      window.innerWidth - NOTE_POPOVER_WIDTH - 8
    )
  );
  const preferredY = rect.bottom + 10;
  const y =
    preferredY + height <= window.innerHeight - 8
      ? preferredY
      : Math.max(8, rect.top - height - 10);

  return { x, y };
}

function positionFloatingPoint(x: number, y: number, width: number, height: number) {
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8))
  };
}

function selectionAnchorRect() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const rect = Array.from(range.getClientRects()).find(
    (clientRect) => clientRect.width > 0 || clientRect.height > 0
  );

  if (rect) {
    return rect;
  }

  const fallbackRect = range.getBoundingClientRect();
  return fallbackRect.width > 0 || fallbackRect.height > 0 ? fallbackRect : null;
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
  const loadedPagePathRef = useRef<string | null>(null);
  const lastEmittedHtmlRef = useRef(bodyHtml);

  useEffect(() => {
    const isNewPage = loadedPagePathRef.current !== pagePath;
    const isExternalUpdate = bodyHtml !== lastEmittedHtmlRef.current;

    if (!isNewPage && !isExternalUpdate) {
      return;
    }

    editor.update(() => importHtmlIntoEditor(editor, bodyHtml), {
      tag: AMANITE_HTML_LOAD_TAG
    });
    loadedPagePathRef.current = pagePath;
    lastEmittedHtmlRef.current = bodyHtml;
  }, [bodyHtml, editor, pagePath]);

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

    lastEmittedHtmlRef.current = nextBodyHtml;
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
  pages,
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
  const [notePopover, setNotePopover] = useState<NotePopoverState | null>(null);
  const [tagDraft, setTagDraft] = useState("");
  const notePopoverEditorRef = useRef<HTMLTextAreaElement>(null);
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
    setNotePopover(null);
  }, [pagePath]);

  useEffect(() => {
    if (isAddingTag) {
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }, [isAddingTag]);

  useEffect(() => {
    if (notePopover?.kind === "create" || notePopover?.kind === "edit") {
      requestAnimationFrame(() => notePopoverEditorRef.current?.focus());
    }
  }, [notePopover?.kind]);

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
    window.addEventListener("contextmenu", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu, true);
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

  function noteFromAnchor(anchor: HTMLAnchorElement) {
    const href = anchor.getAttribute("href") ?? "";

    if (!href.startsWith("#")) {
      return null;
    }

    const noteId = href.slice(1);
    return notes.find((note) => note.id === noteId) ?? null;
  }

  function openNoteDetailAtAnchor(note: FractalNote, anchor: HTMLAnchorElement) {
    const position = positionFloatingPopover(
      anchor.getBoundingClientRect(),
      NOTE_DETAIL_POPOVER_HEIGHT
    );

    setNotePopover({
      kind: "note-detail",
      note,
      ...position
    });
  }

  function openNoteEditor(note: FractalNote) {
    setNotePopover((currentPopover) => ({
      draft: note.text,
      kind: "edit",
      note,
      x: currentPopover?.x ?? 16,
      y: currentPopover?.y ?? 16
    }));
  }

  function deleteNoteFromPopover(note: FractalNote) {
    onDeleteNote(note);
    setNotePopover(null);
  }

  function closeHoverPopover() {
    setNotePopover((currentPopover) =>
      currentPopover?.kind === "note-preview" || currentPopover?.kind === "page-preview"
        ? null
        : currentPopover
    );
  }

  function handleEditorMouseMove(event: MouseEvent<HTMLDivElement>) {
    const targetNode = event.target instanceof Node ? event.target : null;
    const target = targetNode instanceof HTMLElement ? targetNode : targetNode?.parentElement;
    const anchor = target?.closest<HTMLAnchorElement>("a[href]");

    if (!anchor) {
      closeHoverPopover();
      return;
    }

    const note = noteFromAnchor(anchor);
    const page = note ? null : resolvePageForAnchor(anchor, pagePath, pages, outlinks);

    if (!note && !page) {
      closeHoverPopover();
      return;
    }

    const position = positionFloatingPopover(
      anchor.getBoundingClientRect(),
      NOTE_PREVIEW_POPOVER_HEIGHT
    );

    setNotePopover((currentPopover) => {
      if (
        currentPopover &&
        currentPopover.kind !== "note-preview" &&
        currentPopover.kind !== "page-preview"
      ) {
        return currentPopover;
      }

      if (
        note &&
        currentPopover?.kind === "note-preview" &&
        currentPopover.note.id === note.id &&
        currentPopover.x === position.x &&
        currentPopover.y === position.y
      ) {
        return currentPopover;
      }

      if (
        page &&
        currentPopover?.kind === "page-preview" &&
        currentPopover.page.path === page.path &&
        currentPopover.x === position.x &&
        currentPopover.y === position.y
      ) {
        return currentPopover;
      }

      return note
        ? {
            kind: "note-preview",
            note,
            ...position
          }
        : {
            kind: "page-preview",
            page: page!,
            ...position
          };
    });
  }

  function handleEditorMouseLeave() {
    closeHoverPopover();
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
      const note = noteFromAnchor(anchor);

      if (note) {
        event.preventDefault();
        openNoteDetailAtAnchor(note, anchor);
        return;
      }

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

    const nextPagePath = resolvePagePathForAnchor(anchor, pagePath, pages, outlinks);

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
    closeHoverPopover();

    const menuPosition = positionFloatingPoint(
      event.clientX,
      event.clientY,
      NOTE_CONTEXT_MENU_WIDTH,
      NOTE_CONTEXT_MENU_HEIGHT
    );
    const selectionRect = selectionAnchorRect();
    const popoverPosition = selectionRect
      ? positionFloatingPopover(selectionRect, NOTE_EDITOR_POPOVER_HEIGHT)
      : positionFloatingPoint(
          event.clientX,
          event.clientY,
          NOTE_POPOVER_WIDTH,
          NOTE_EDITOR_POPOVER_HEIGHT
        );

    setNoteMenu({
      popoverX: popoverPosition.x,
      popoverY: popoverPosition.y,
      trigger: selectedText,
      ...menuPosition
    });
  }

  function handleAddNoteFromMenu() {
    if (!noteMenu) {
      return;
    }

    setNotePopover({
      draft: "",
      kind: "create",
      trigger: noteMenu.trigger,
      x: noteMenu.popoverX,
      y: noteMenu.popoverY
    });
    setNoteMenu(null);
  }

  function cancelNotePopover() {
    setNotePopover(null);
  }

  function updateNotePopoverDraft(draft: string) {
    setNotePopover((currentPopover) => {
      if (
        !currentPopover ||
        (currentPopover.kind !== "create" && currentPopover.kind !== "edit")
      ) {
        return currentPopover;
      }

      return {
        ...currentPopover,
        draft
      };
    });
  }

  function commitNotePopover() {
    if (!notePopover || (notePopover.kind !== "create" && notePopover.kind !== "edit")) {
      return;
    }

    if (notePopover.kind === "create") {
      onAddNote(notePopover.trigger, notePopover.draft);
    } else {
      onUpdateNote(notePopover.note, notePopover.draft);
    }

    setNotePopover(null);
  }

  function handleNotePopoverKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      commitNotePopover();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelNotePopover();
    }
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

  const linkItems = uniqueInspectorItems(
    links,
    (link) => link.href,
    (link) => `${link.text} -> ${link.href}`
  );
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
      onMouseLeave={handleEditorMouseLeave}
      onMouseMove={handleEditorMouseMove}
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
          onClick={(event) => event.stopPropagation()}
          role="menu"
          style={{ left: noteMenu.x, top: noteMenu.y }}
        >
          <p title={noteMenu.trigger}>{noteMenu.trigger}</p>
          <button onClick={handleAddNoteFromMenu} role="menuitem" type="button">
            Add note
          </button>
        </div>
      ) : null}

      {notePopover ? (
        <div
          aria-label={
            notePopover.kind === "page-preview"
              ? "Page preview"
              : notePopover.kind === "note-preview"
                ? "Note preview"
                : "Note dialog"
          }
          className={
            notePopover.kind === "note-preview" || notePopover.kind === "page-preview"
              ? "note-popover preview"
              : notePopover.kind === "note-detail"
                ? "note-popover detail"
                : "note-popover editor"
          }
          onClick={(event) => event.stopPropagation()}
          onMouseMove={(event) => event.stopPropagation()}
          role={
            notePopover.kind === "note-preview" || notePopover.kind === "page-preview"
              ? "tooltip"
              : "dialog"
          }
          style={{ left: notePopover.x, top: notePopover.y }}
        >
          {notePopover.kind === "note-preview" ? (
            <>
              <div className="note-popover-kicker">Note preview</div>
              <strong title={notePopover.note.label}>{notePopover.note.label}</strong>
              <p>{truncateNotePreview(notePopover.note.text)}</p>
              <small>Click to expand note.</small>
            </>
          ) : notePopover.kind === "page-preview" ? (
            <>
              <div className="note-popover-kicker">Page preview</div>
              <strong title={notePopover.page.path}>{notePopover.page.name}</strong>
              <p>{pagePreviewText(notePopover.page)}</p>
              <small>{notePopover.page.path}</small>
            </>
          ) : notePopover.kind === "note-detail" ? (
            <>
              <div className="note-popover-heading">
                <div>
                  <div className="note-popover-kicker">Note</div>
                  <strong title={notePopover.note.label}>{notePopover.note.label}</strong>
                </div>
                <div className="note-popover-icon-actions" aria-label="Note actions">
                  <button
                    aria-label={`Edit note for ${notePopover.note.label}`}
                    disabled={isBusy}
                    onClick={() => openNoteEditor(notePopover.note)}
                    title="Edit note"
                    type="button"
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="M2.5 11.6 2 14l2.4-.5 8.2-8.2-1.9-1.9-8.2 8.2Z" />
                      <path d="m9.8 4.3 1.9 1.9" />
                    </svg>
                  </button>
                  <button
                    aria-label={`Delete note for ${notePopover.note.label}`}
                    className="danger"
                    disabled={isBusy}
                    onClick={() => deleteNoteFromPopover(notePopover.note)}
                    title="Delete note"
                    type="button"
                  >
                    <svg aria-hidden="true" viewBox="0 0 16 16">
                      <path d="M3.5 5h9" />
                      <path d="M6.2 5V3.4h3.6V5" />
                      <path d="M4.5 5.5 5.1 14h5.8l.6-8.5" />
                      <path d="M7 7.4v4.2" />
                      <path d="M9 7.4v4.2" />
                    </svg>
                  </button>
                  <button
                    aria-label="Close note"
                    onClick={cancelNotePopover}
                    title="Close"
                    type="button"
                  >
                    ×
                  </button>
                </div>
              </div>
              <p className="note-popover-full-text">
                {notePopover.note.text || "No note body yet."}
              </p>
            </>
          ) : (
            <>
              <div className="note-popover-kicker">
                {notePopover.kind === "create" ? "New note" : "Edit note"}
              </div>
              <strong
                title={
                  notePopover.kind === "create" ? notePopover.trigger : notePopover.note.label
                }
              >
                {notePopover.kind === "create" ? notePopover.trigger : notePopover.note.label}
              </strong>
              <textarea
                aria-label={
                  notePopover.kind === "create"
                    ? `New note body for ${notePopover.trigger}`
                    : `Note body for ${notePopover.note.label}`
                }
                disabled={isBusy}
                onChange={(event) => updateNotePopoverDraft(event.currentTarget.value)}
                onKeyDown={handleNotePopoverKeyDown}
                placeholder="Write the note body..."
                ref={notePopoverEditorRef}
                rows={4}
                value={notePopover.draft}
              />
              <div className="note-popover-actions">
                <button className="ghost-action" onClick={cancelNotePopover} type="button">
                  Cancel
                </button>
                <button
                  className="primary-action"
                  disabled={isBusy}
                  onClick={commitNotePopover}
                  type="button"
                >
                  {notePopover.kind === "create" ? "Create note" : "Save note"}
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}

      <aside className="fractal-inspector" aria-label="Fractal page context">
        <section className="fractal-inspector-card">
          <p className="fractal-inspector-kicker">Context</p>
          <dl className="fractal-stats">
            <div>
              <dt>Links</dt>
              <dd>{linkItems.length}</dd>
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
