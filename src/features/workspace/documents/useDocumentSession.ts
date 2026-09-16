import { useMemo } from "react";
import { DocumentRegistry, type DocumentSeed, type DocumentSession } from "./documentRuntime";

export function useDocumentSession(registry: DocumentRegistry, path: string, seed: DocumentSeed): DocumentSession {
  return useMemo(
    () => registry.openLoaded(path, seed).session,
    [path, registry]
  );
}
