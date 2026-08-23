# Amanite

Amanite is a small Tauri desktop editor for [Fractal](../fractal) projects.

It follows Fractal's current contract directly:

- projects contain `fractal.json` and `pages/`;
- native documents use `.fractal.html`, while other `.html` files are raw source;
- files are the source of truth;
- links, backlinks, iframes, and iframe backlinks are derived when a project is opened;
- there is no generated index, graph store, note primitive, metadata schema, theme contract, or sync step.

Amanite can create and open projects, manage page folders, create/read/write/move/delete pages, inspect links and iframe references, and run Fractal validation. Native `.fractal.html` documents use the rich editor. Ordinary `.html` files open as rendered documents and can be toggled to their complete HTML source. Internal links in rendered documents open their Fractal target in Amanite. Both editors persist complete HTML through Fractal. Amanite creates folders directly; when deleting one, it asks Fractal to delete each contained page before removing the directory.

Amanite keeps temporary recovery drafts for unsaved pages and local appearance preferences in the desktop webview. Recovery drafts contain the same complete HTML source used by the editor. They are removed after a confirmed Fractal write and never replace project files as the source of truth.

## Development

```sh
pnpm install
pnpm run build
pnpm run tauri:dev
```

Amanite stores projects in the platform app-data directory by default. Override the project library with:

```sh
AMANITE_PROJECT_ROOT="$HOME/fractal-projects" pnpm run tauri:dev
```

Frontend-only Vite mode cannot access projects because persistence runs through Tauri and the Fractal Rust crate.

## Desktop debugging

Use the real Tauri WebDriver harness:

```sh
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
pnpm run tauri:webdriver:open
```

Artifacts are written below `artifacts/tauri-webdriver/`. See [`docs/tauri-webdriver.md`](docs/tauri-webdriver.md).

## Structure

```text
src/app/                  session orchestration
src/lib/fractal/          typed Tauri client and DTOs
src/features/editor/      native rich editor, rendered HTML, source editor, and reference inspector
src/features/workspace/   page list and workspace shell
src-tauri/src/lib.rs      thin adapter over fractal::Project
```
