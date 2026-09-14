import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { TableCellNode, TableNode, TableRowNode } from "@lexical/table";
import { createEditor, type LexicalEditor } from "lexical";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { DerivedLinkNode } from "./DerivedLinkNode";
import { editorLexicalTheme } from "./editorLexicalTheme";

export const amaniteEditorNodes = [
  CodeNode,
  DerivedLinkNode,
  HeadingNode,
  HorizontalRuleNode,
  LinkNode,
  ListItemNode,
  ListNode,
  QuoteNode,
  TableCellNode,
  TableNode,
  TableRowNode
] as const;

export function createAmaniteEditor(namespace: string) {
  const editor = createEditor({
    namespace,
    nodes: amaniteEditorNodes,
    onError(error) { throw error; },
    theme: editorLexicalTheme
  });
  return editor;
}

export function editorConfig(namespace: string) {
  return {
    namespace,
    nodes: amaniteEditorNodes,
    onError(error: Error) { throw error; },
    theme: editorLexicalTheme
  };
}

export type AmaniteEditor = LexicalEditor;

