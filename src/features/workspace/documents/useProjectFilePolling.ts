import { useEffect } from "react";
import { fractalClient } from "@/lib/fractal/client";
import type { FractalProject } from "@/lib/fractal/types";
import type { BufferUpdater, DocumentBuffers } from "./documentBuffers";

type MutableValue<T> = { current: T };

type Options = {
  buffersRef: MutableValue<DocumentBuffers>;
  commitBuffers: (updater: BufferUpdater) => void;
  projectRef: MutableValue<FractalProject>;
};

export function useProjectFilePolling({ buffersRef, commitBuffers, projectRef }: Options) {
  useEffect(() => {
    let checking = false;
    const interval = window.setInterval(async () => {
      if (checking) return;
      const snapshot = Object.values(buffersRef.current).filter((buffer) => !buffer.operation);
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
            if (state.contentHash != null && checked.contentHash != null && state.contentHash === checked.contentHash) continue;
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
      } catch {
        // Polling must not interrupt editing or saving.
      } finally {
        checking = false;
      }
    }, 3000);
    return () => window.clearInterval(interval);
  }, [buffersRef, commitBuffers, projectRef]);
}
