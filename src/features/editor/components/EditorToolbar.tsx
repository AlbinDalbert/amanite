import { INSERT_ORDERED_LIST_COMMAND, INSERT_UNORDERED_LIST_COMMAND } from "@lexical/list";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $setBlocksType } from "@lexical/selection";
import { $createParagraphNode, $getSelection, $isRangeSelection, FORMAT_TEXT_COMMAND, type TextFormatType } from "lexical";
import { $createHeadingNode, $createQuoteNode, type HeadingTagType } from "@lexical/rich-text";

type ButtonProps = { label: string; title: string; onClick: () => void };
function ToolButton({ label, title, onClick }: ButtonProps) {
  return <button className="rich-toolbar-button" onClick={onClick} title={title} type="button">{label}</button>;
}

function EditorToolbar() {
  const [editor] = useLexicalComposerContext();
  const text = (format: TextFormatType) => editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  const block = (kind: "paragraph" | "quote" | HeadingTagType) => editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    if (kind === "paragraph") $setBlocksType(selection, () => $createParagraphNode());
    else if (kind === "quote") $setBlocksType(selection, () => $createQuoteNode());
    else $setBlocksType(selection, () => $createHeadingNode(kind));
  });

  return (
    <div className="rich-toolbar" aria-label="Text formatting">
      <div className="rich-toolbar-group">
        <ToolButton label="B" title="Bold" onClick={() => text("bold")} />
        <ToolButton label="I" title="Italic" onClick={() => text("italic")} />
        <ToolButton label="U" title="Underline" onClick={() => text("underline")} />
      </div>
      <div className="rich-toolbar-group">
        <ToolButton label="Text" title="Paragraph" onClick={() => block("paragraph")} />
        <ToolButton label="H1" title="Heading 1" onClick={() => block("h1")} />
        <ToolButton label="H2" title="Heading 2" onClick={() => block("h2")} />
        <ToolButton label="Quote" title="Quote" onClick={() => block("quote")} />
      </div>
      <div className="rich-toolbar-group">
        <ToolButton label="• List" title="Bulleted list" onClick={() => editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)} />
        <ToolButton label="1. List" title="Numbered list" onClick={() => editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)} />
      </div>
    </div>
  );
}

export default EditorToolbar;
