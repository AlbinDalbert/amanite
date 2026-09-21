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
  registry.openLoaded("notes.fractal.html", { bodyHtml: "<p>Initial</p>", title: "Notes" });

  function Harness({ path }: { path: string }) {
    const session = useDocumentSession(registry, path);
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

it("lets an explicit reload replace the existing session", async () => {
  const registry = new DocumentRegistry({ projectGeneration: 13 });
  const container = document.createElement("div");
  let captured: DocumentSession | undefined;
  registry.openLoaded("notes.fractal.html", { bodyHtml: "<p>Initial</p>", initialReplacementGeneration: 1, title: "Notes" });

  function Harness() {
    const session = useDocumentSession(registry, "notes.fractal.html");
    useEffect(() => { captured = session; }, [session]);
    return null;
  }

  const root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    const first = captured;
    expect(first).toBeDefined();

    first?.replaceDocument("<p>Reloaded</p>", "Reloaded notes", 2);
    await act(async () => root.render(<Harness />));

    expect(captured).toBe(first);
    expect(captured?.getSnapshot()).toMatchObject({ bodyDirty: false, replacementGeneration: 2, title: "Reloaded notes" });
    expect(captured?.editor.getEditorState().read(() => $getRoot().getTextContent())).toBe("Reloaded");
  } finally {
    await act(async () => root.unmount());
    registry.dispose();
  }
});
