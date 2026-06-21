import {
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND
} from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { mergeRegister } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type TextFormatType
} from "lexical";
import { useCallback, useEffect, useState } from "react";
import {
  $createHeadingNode,
  $createQuoteNode,
  type HeadingTagType
} from "@lexical/rich-text";

type ToolbarButtonProps = {
  isActive?: boolean;
  label: string;
  title: string;
  onClick: () => void;
};

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

export default EditorToolbar;
