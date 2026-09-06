import { useEffect } from "react";
import { writePageDraftSource } from "@/app/pageDrafts";
import { errorMessage, type DocumentBuffers } from "./documentBuffers";

type Options = {
  autoSave: boolean;
  buffers: DocumentBuffers;
  projectRoot: string;
  saveDocument: (path: string) => Promise<boolean>;
  onStorageError: (message: string | null) => void;
};

export function useDocumentDrafts({ autoSave, buffers, projectRoot, saveDocument, onStorageError }: Options) {
  useEffect(() => {
    const dirty = Object.values(buffers).filter((buffer) => buffer.dirty);
    if (!dirty.length) return;

    const draftTimeout = window.setTimeout(() => {
      for (const buffer of dirty) {
        void writePageDraftSource(projectRoot, buffer.path, buffer.source, buffer.contentHash ?? "")
          .then(() => onStorageError(null))
          .catch((error) => onStorageError(errorMessage(error)));
      }
    }, 180);
    const autoSavePaths = dirty
      .filter((buffer) => !buffer.conflict && !buffer.operation)
      .map((buffer) => buffer.path);
    const saveTimeout = autoSave && autoSavePaths.length ? window.setTimeout(() => {
      void (async () => {
        for (const path of autoSavePaths) {
          if (!(await saveDocument(path))) break;
        }
      })();
    }, 900) : null;

    return () => {
      window.clearTimeout(draftTimeout);
      if (saveTimeout != null) window.clearTimeout(saveTimeout);
    };
  }, [autoSave, buffers, onStorageError, projectRoot, saveDocument]);
}
