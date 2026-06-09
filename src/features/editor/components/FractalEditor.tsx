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
import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from "react";
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
  onChangeBodyHtml: (bodyHtml: string) => void;
  onChangeTitle: (title: string) => void;
  onSave: () => void;
};

type ToolbarButtonProps = {
  isActive?: boolean;
  label: string;
  title: string;
  onClick: () => void;
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
  onChangeBodyHtml,
  onChangeTitle,
  onSave
}: FractalEditorProps) {
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
    <div className="fractal-editor rich-editor" onKeyDown={handleEditorKeyDown}>
      <section className="rich-document-shell" aria-label="Fractal rich editor">
        <LexicalComposer initialConfig={editorConfig} key={pagePath}>
          <header className="rich-editor-header">
            <div className="rich-editor-status">
              <span className="editor-pane-title">Live Fractal page</span>
              <span className={isDirty ? "editor-state dirty" : "editor-state"}>
                {isDirty ? "Unsaved" : "Saved"}
              </span>
            </div>

            <EditorToolbar />

            <button
              className={isDirty ? "editor-save-action dirty" : "editor-save-action"}
              disabled={isBusy || !isDirty}
              onClick={onSave}
              type="button"
            >
              {isBusy ? "Busy" : isDirty ? "Save" : "Saved"}
            </button>
          </header>

          <article className="rich-page-canvas">
            <div className="rich-page-meta">
              <span className="editor-page-path" title={pagePath}>
                {pagePath}
              </span>
              {tags.length > 0 ? (
                <div className="rich-tag-row" aria-label="Page tags">
                  {tags.map((tag) => (
                    <span className="rich-tag" key={tag}>
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>

            <textarea
              aria-label={`Title for ${pagePath}`}
              className="rich-title-input"
              onChange={(event) => onChangeTitle(event.currentTarget.value)}
              placeholder="Untitled"
              rows={1}
              value={title}
            />

            {summary ? <p className="rich-summary">{summary}</p> : null}

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
          </article>
        </LexicalComposer>
      </section>

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
