import { useEffect, useMemo, useState } from "react";
import { DocumentRegistry, type DocumentSession } from "./documentRuntime";

export function useDocumentSession(registry: DocumentRegistry, path: string): DocumentSession {
  const session = useMemo(() => {
    const existing = registry.getByPath(path);
    if (!existing) throw new Error(`Document session is not open: ${path}`);
    return existing;
  }, [path, registry]);
  const [, setVersion] = useState(0);
  useEffect(() => {
    const unsubscribe = session.subscribe(() => setVersion((version) => version + 1));
    return () => { unsubscribe(); };
  }, [session]);

  return session;
}
