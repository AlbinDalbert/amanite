import type { FractalNativeSection } from "@/lib/fractal/types";
import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";
import type { EditorSnapshot } from "@/features/editor/components/editorFlush";

export type WorkspaceDocumentCallbacks = {
  onChangeSource: (path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onModelChange?: (path: string, snapshot: EditorModelSnapshot) => void;
  onRevision?: (path: string, revision?: number) => void;
  onSnapshot?: (path: string, snapshot: EditorSnapshot) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onEnsurePage: (path: string) => Promise<boolean>;
};
