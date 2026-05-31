import { useEffect, useRef } from "react";
import { html } from "@codemirror/lang-html";
import { basicSetup, EditorView } from "codemirror";

const starterDocument = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>index</title>
    <meta name="fractal:version" content="0.1" />
    <meta name="fractal:summary" content="Short page summary here." />
    <meta name="fractal:tags" content="rust, graphs, parsing" />
    <link rel="stylesheet" href="../.fractal/style.css">
  </head>
  <body data-fractal-theme="dark">
    <main>
      <h1>index</h1>
      <p>Fractal project scaffold.</p>
    </main>
    <section data-fractal-notes>
    </section>
  </body>
</html>
`;

function App() {
  const editorHostRef = useRef<HTMLDivElement>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  useEffect(() => {
    if (!editorHostRef.current) {
      return;
    }

    const view = new EditorView({
      doc: starterDocument,
      extensions: [
        basicSetup,
        html(),
        EditorView.lineWrapping,
        EditorView.theme({
          "&": {
            height: "100%",
            backgroundColor: "#141410",
            color: "#ece6d8"
          },
          ".cm-scroller": {
            fontFamily:
              '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace'
          },
          ".cm-content": {
            padding: "18px 0",
            caretColor: "#79d6a3"
          },
          ".cm-line": {
            padding: "0 18px"
          },
          ".cm-gutters": {
            backgroundColor: "#10100d",
            color: "#817966",
            borderRight: "1px solid #2f2b22"
          },
          ".cm-activeLine": {
            backgroundColor: "#25251d"
          },
          ".cm-activeLineGutter": {
            backgroundColor: "#25251d"
          },
          ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
            backgroundColor: "#3c6147"
          },
          "&.cm-focused": {
            outline: "none"
          }
        })
      ],
      parent: editorHostRef.current
    });

    editorViewRef.current = view;

    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, []);

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Project pages">
        <div className="brand">
          <span className="brand-mark">A</span>
          <div>
            <h1>Amanite</h1>
            <p>Fractal editor</p>
          </div>
        </div>

        <nav className="page-list" aria-label="Pages">
          <button className="page-link active" type="button">
            index.html
          </button>
          <button className="page-link" type="button">
            nested/subpage.html
          </button>
        </nav>
      </aside>

      <section className="workspace" aria-label="Editor workspace">
        <header className="toolbar">
          <div>
            <p className="eyebrow">pages/index.html</p>
            <h2>HTML Source</h2>
          </div>
          <div className="actions">
            <button type="button">Validate</button>
            <button type="button">Build Index</button>
          </div>
        </header>

        <div className="editor-grid">
          <section className="editor-pane" aria-label="Source editor">
            <div ref={editorHostRef} className="editor-host" />
          </section>

          <section className="preview-pane" aria-label="Document preview">
            <article>
              <h1>index</h1>
              <p>Fractal project scaffold.</p>
            </article>
            <section className="notes-preview" aria-label="Notes">
              <h2>Notes</h2>
              <p>No notes yet.</p>
            </section>
          </section>
        </div>
      </section>
    </main>
  );
}

export default App;
