import { useEffect, useMemo } from "react";
import { DocumentRegistry, type DocumentSeed, type DocumentSession } from "./documentRuntime";

export function useDocumentSession(registry: DocumentRegistry, path: string, seed: DocumentSeed): DocumentSession {
  const session = useMemo(
    () => registry.openLoaded(path, seed).session,
    [path, registry]
  );

  const replacementGeneration = seed.initialReplacementGeneration ?? 1;
  useEffect(() => {
    const snapshot = session.getSnapshot();
    if (replacementGeneration <= snapshot.replacementGeneration) return;
    session.replaceDocument(seed.bodyHtml, seed.title, replacementGeneration, seed.initialRevision);
  }, [replacementGeneration, seed.bodyHtml, seed.initialRevision, seed.title, session]);

  return session;
}
