import type { FractalNativeSection } from "@/lib/fractal/types";

export type WorkspaceDocumentCallbacks = {
  onChangeSource: (path: string, source: string, nativeSection?: { section: FractalNativeSection; value: string }) => void;
  onCreateFolder: (path: string) => void;
  onCreatePage: (title: string, folderPath?: string) => void;
  onEnsurePage: (path: string) => Promise<boolean>;
};
