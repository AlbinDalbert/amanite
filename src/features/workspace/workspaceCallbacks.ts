import type { FractalNativeSection } from "@/lib/fractal/types";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";

export type WorkspaceDocumentCallbacks = {
  onChangeSource: (path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onModelChange?: (path: string, snapshot: EditorModelSnapshot) => void;
  onRevision?: (path: string, revision?: number) => void;
  onSnapshot?: (path: string, bodyHtml: string, revision: number) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onEnsurePage: (path: string) => Promise<boolean>;
};
