import { useEffect } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalPageContentState, FractalProject } from "@/lib/fractal/types";
import type { BufferUpdater, DocumentBuffer, DocumentBuffers } from "./documentBuffers";
import { errorMessage } from "./documentBuffers";

type MutableValue<T> = { current: T };

type Options = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  onError: (message: string) => void;
  projectRef: MutableValue<FractalProject>;
};

function hasExternalChange(buffer: DocumentBuffer, state: FractalPageContentState) {
  if (buffer.kind !== "native" || !buffer.nativeDocumentParts || !state.nativeDocumentHashes) {
    return state.contentHash !== buffer.contentHash;
  }
  const hashes = state.nativeDocumentHashes;
  const pendingSections = Object.keys(buffer.nativeEdits) as Array<keyof typeof buffer.nativeEdits>;
  if (pendingSections.length) {
    return pendingSections.some((section) => {
      const hashKey = section === "headLinks" ? "headLinksHash" : `${section}Hash` as keyof typeof hashes;
      return hashes[hashKey] !== buffer.nativeDocumentParts?.[hashKey];
    });
  }
  return hashes.sourceHash !== buffer.nativeDocumentParts.sourceHash;
}

export function useProjectFilePolling({ buffersRef, commitBuffers, onError, projectRef }: Options) {
  useEffect(() => {
    let checking = false;
    const interval = window.setInterval(async () => {
      if (checking) return;
      const buffers = Object.values(buffersRef.current);
      if (buffers.some((buffer) => buffer.operation)) return;
      const snapshot = buffers;
      if (!snapshot.length) return;

      checking = true;
      try {
        const states = await fractalClient.pageContentStates(projectRef.current, snapshot.map((buffer) => buffer.path));
        const expected = new Map(snapshot.map((buffer) => [buffer.path, buffer]));
        commitBuffers((current) => {
          let next = current;
          for (const state of states) {
            const checked = expected.get(state.path);
            const latest = current[state.path];
            if (!checked || !latest || latest.contentHash !== checked.contentHash || latest.operation) continue;
            if (!hasExternalChange(checked, state)) continue;
            if (next === current) next = { ...current };
            next[state.path] = {
              ...latest,
              conflict: true,
              error: state.contentHash == null
                ? "This page was removed from disk. Reload the project or replace the missing file."
                : "This page changed on disk. Reload it or replace the external version."
            };
          }
          return next;
        });
      } catch (error) {
        onError(errorMessage(error));
      } finally {
        checking = false;
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [buffersRef, commitBuffers, onError, projectRef]);
}
