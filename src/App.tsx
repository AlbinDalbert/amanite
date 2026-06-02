const files = [
  { name: "index", path: "pages/index.html", active: true },
  { name: "garden", path: "pages/garden.html", active: false },
  { name: "subpage", path: "pages/nested/subpage.html", active: false }
];

function App() {
  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="File explorer">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <h1>Amanite</h1>
            <p>test_proj</p>
          </div>
        </div>

        <div className="explorer-header">
          <span>Pages</span>
          <button type="button" aria-label="Create page">
            +
          </button>
        </div>

        <nav className="file-list" aria-label="Project files">
          {files.map((file) => (
            <button
              className={file.active ? "file-link active" : "file-link"}
              key={file.path}
              type="button"
            >
              <span className="file-name">{file.name}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="workspace" aria-label="Editor">
        <main className="document" aria-label="Editable page">
          <h1
            contentEditable
            suppressContentEditableWarning
            aria-label="Page title"
            spellCheck="false"
          >
            test_proj
          </h1>

          <div
            className="page-body"
            contentEditable
            suppressContentEditableWarning
            aria-label="Page content"
          >
            <p>
              Lorem ipsum dolor sit amet, consectetur adipiscing elit. Proin
              velit magna, convallis eget placerat at, efficitur nec ipsum.
              Praesent gravida eu massa vitae volutpat.
            </p>
            <p>
              Mauris et posuere neque, in lobortis nisi. In congue dapibus
              dapibus. Proin consectetur, dolor vel placerat eleifend, elit eros
              mollis dolor, a aliquam elit mauris non ex.
            </p>
            <p>
              Quisque eget nulla eu augue faucibus placerat. Praesent tincidunt,
              quam in aliquam dapibus, risus nulla porta arcu, at ornare purus
              urna ac arcu.
            </p>
          </div>

          <section className="notes" aria-label="Page notes">
            <div
              className="note-entry"
              contentEditable
              suppressContentEditableWarning
              aria-label="New note"
            >
              Select text or start writing here to keep a note with this page.
            </div>
          </section>
        </main>
      </section>
    </main>
  );
}

export default App;
