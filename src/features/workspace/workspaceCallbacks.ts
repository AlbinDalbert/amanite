import type { EditorModelSnapshot } from "@/features/editor/components/editorModel";

export type WorkspaceDocumentCallbacks = {
  onModelChange?: (path: string, snapshot: EditorModelSnapshot) => void;
  onRevision?: (path: string, revision?: number) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onEnsurePage: (path: string) => Promise<boolean>;
};
