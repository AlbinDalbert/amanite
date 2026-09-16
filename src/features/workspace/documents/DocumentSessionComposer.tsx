import { LexicalComposerContext, type LexicalComposerContextType } from "@lexical/react/LexicalComposerContext";
import type { LexicalEditor } from "lexical";
import { useMemo, type ReactNode } from "react";
import type { DocumentSession } from "./documentRuntime";

export default function DocumentSessionComposer({ children, session }: { children: ReactNode; session: DocumentSession }) {
  const value = useMemo<[LexicalEditor, LexicalComposerContextType]>(() => [session.editor, session.context], [session]);
  return <LexicalComposerContext.Provider value={value}>{children}</LexicalComposerContext.Provider>;
}
