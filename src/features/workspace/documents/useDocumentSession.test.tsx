import { $getRoot } from "lexical";
import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { DocumentRegistry, type DocumentSession } from "./documentRuntime";
import { useDocumentSession } from "./useDocumentSession";

it("keeps a document session alive across view unmounts and reuses it on remount", async () => {
  const registry = new DocumentRegistry({ projectGeneration: 12 });
  const container = document.createElement("div");
  let captured: DocumentSession | undefined;

  function Harness({ path }: { path: string }) {
    const session = useDocumentSession(registry, path, { bodyHtml: "<p>Initial</p>", title: "Notes" });
    useEffect(() => { captured = session; }, [session]);
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness path="notes.fractal.html" />));
    const first = captured;
    expect(first).toBeDefined();
    expect(registry.size).toBe(1);

    await act(async () => root.render(null));
    expect(registry.getByPath("notes.fractal.html")).toBe(first);
    expect(first?.getSnapshot().disposed).toBe(false);

    await act(async () => root.render(<Harness path="notes.fractal.html" />));
    expect(captured).toBe(first);
    expect(captured?.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Initial");
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});

it("installs a newer buffer incarnation into the existing session", async () => {
  const registry = new DocumentRegistry({ projectGeneration: 13 });
  const container = document.createElement("div");
  let captured: DocumentSession | undefined;

  function Harness({ generation, title, bodyHtml }: { generation: number; title: string; bodyHtml: string }) {
    const session = useDocumentSession(registry, "notes.fractal.html", { bodyHtml, initialReplacementGeneration: generation, title });
    useEffect(() => { captured = session; }, [session]);
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness bodyHtml="<p>Initial</p>" generation={1} title="Notes" />));
    const first = captured;
    expect(first).toBeDefined();

    await act(async () => root.render(<Harness bodyHtml="<p>Reloaded</p>" generation={2} title="Reloaded notes" />));

    expect(captured).toBe(first);
    expect(captured?.getSnapshot()).toMatchObject({ bodyDirty: false, replacementGeneration: 2, title: "Reloaded notes" });
    expect(captured?.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Reloaded");
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});
