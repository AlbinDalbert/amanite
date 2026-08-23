# Amanite

Amanite is a small Tauri desktop editor for [Fractal](../fractal) projects.

It follows Fractal's current contract directly:

- projects contain `fractal.json` and `pages/`;
- native documents use `.fractal.html`, while other `.html` files are raw source;
- files are the source of truth;
- links, backlinks, iframes, and iframe backlinks are derived when a project is opened;
- there is no generated index, graph store, note primitive, metadata schema, theme contract, or sync step.

Amanite can create and open projects, including projects outside its default library. It manages page folders and can create, import, duplicate, read, write, move, reveal, and delete pages. It searches page titles and visible text through Fractal, renders exact page-title mentions as derived links, inspects explicit links and iframe references, and runs Fractal validation.

Native `.fractal.html` documents stay in the rich editor and never expose an HTML source or preview mode in the workspace. The editor has document find and replace, undo and redo, semantic formatting, table controls, local image paste and drop, an internal-page link picker, an outline, counts, reading time, word goals, print support, and a focus mode. Typing `@` opens a page picker at the caret and inserts an explicit file link. Exact page-title mentions become clickable derived links as the user types, without changing the saved HTML. A normal click follows explicit and derived internal links. Ordinary `.html` files open as rendered documents and can be toggled to their complete HTML source. Derived links are also applied to rendered raw pages without changing their files. Both editors persist complete HTML through Fractal.

Amanite saves before changing pages and can autosave after 900 ms without typing. It keeps temporary recovery drafts for unsaved pages and watches the active file for changes made by another program. Recovery drafts contain the same complete HTML source used by the editor. They are removed after a confirmed Fractal write and never replace project files as the source of truth. The app can restore the last project and page at launch.

The workspace has two independent editor groups. Each group owns an ordered tab list, active page, and navigation history. Drag tabs within a group to reorder them, drag tabs between groups to move them, or drag a tab to the right edge to create the second group. Quick open, the page explorer, links, and Ctrl/Cmd+W act on the focused group. Dirty and conflicted files report their state on their own tabs. The center divider, project sidebar, and each reference inspector can be resized within practical limits.

Useful shortcuts include `Ctrl/Cmd+S` to save, `Ctrl/Cmd+P` to quick-open, `Ctrl/Cmd+F` to find, `Ctrl/Cmd+H` to replace, `Ctrl/Cmd+K` to insert a link, `Ctrl/Cmd+B` to toggle the sidebar, `Ctrl/Cmd+\` to toggle focus mode, and `Ctrl/Cmd+Shift+T` to reopen a closed tab.

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
