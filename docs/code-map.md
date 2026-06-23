# Amanite Code Map

Use this when the product/spec makes sense but the React/Tauri code feels like fog. This is a map of the current code, not an idealized architecture.

## One-sentence model

Amanite is a Tauri React app where UI events call `useFractalSession`, which calls `src/lib/fractal/client.ts`, which invokes Tauri commands, which call the Fractal crate and return a refreshed `FractalProject` view model.

## Read order

If you are lost, read in this order:

1. `src/lib/fractal/types.ts` — the frontend data model.
2. `src/lib/fractal/client.ts` — every frontend/backend call.
3. `src/app/useFractalSession.ts` — async orchestration and dirty-state rules.
4. `src/app/App.tsx` — top-level wiring and confirmation dialog.
5. `src/features/workspace/components/Workspace.tsx` — open-project shell.
6. `src/features/workspace/components/Sidebar.tsx` and `FileExplorer.tsx` — project tree UI.
7. `src/features/editor/components/FractalEditor.tsx` — editor interaction composition.
8. `src/features/editor/components/EditorCanvas.tsx` — Lexical/editor document surface.
9. `src-tauri/src/lib.rs` — backend adapter from Tauri commands to Fractal crate calls.

## Directory roles

```text
src/main.tsx                         React entry
src/app/                             app orchestration and session state
src/lib/fractal/                     typed frontend adapter to Tauri/Fractal
src/features/project-open/           start screen / project catalog UI
src/features/workspace/              open-project shell, sidebar, toolbar, status
src/features/editor/                 rich editor, metadata, notes, links, inspector
src/components/ui/                   reusable UI primitives
src/styles/                          CSS split by surface
src-tauri/src/lib.rs                 Tauri command + Fractal crate adapter
scripts/tauri-desktop-debug.mjs      real desktop WebDriver harness
```

## Main data shape

`FractalProject` in `src/lib/fractal/types.ts` is the frontend view model.

It contains:

- project identity: `name`, `rootPath`;
- tree data: `pages`, `directories`;
- active page data: path, title, body HTML, summary, tags;
- active page context: notes, links, backlinks, outlinks.

Most mutations return a whole refreshed `FractalProject`. The frontend generally trusts that returned state instead of patching deep pieces itself.

## Frontend call chain

```text
Component callback
→ useFractalSession method
→ fractalClient method
→ invoke("fractal_*")
→ Tauri command in src-tauri/src/lib.rs
→ helper in src-tauri/src/lib.rs
→ fractal crate API
→ read_project_with_active_page
→ FractalProject returned to frontend
→ setActiveProject(nextProject)
```

## Key frontend flows

### App startup / project catalog

```text
App
→ useFractalSession()
→ useEffect(refreshProjectCatalog)
→ fractalClient.listProjects
→ Tauri fractal_list_projects
→ list_project_summaries
→ projectCatalog state
→ StartScreen
```

### Open project

```text
StartScreen onOpenProject
→ session.loadProject(() => fractalClient.openProject(directoryName))
→ Tauri fractal_open_project
→ selected_project_root
→ read_project
→ read_project_with_active_page
→ list_fractal_pages + list_fractal_directories
→ active_editor_page_detail
→ FractalProject
→ activeProject state
→ Workspace
```

### Save active page

```text
FractalEditor / Ctrl+S / app menu
→ session.saveActivePage
→ saveProjectPage(activeProject)
→ fractalClient.savePage
→ Tauri fractal_update_page
→ update_project_page
→ fractal::update_editor_page(body/summary/tags)
→ maybe fractal::preflight_rename_page + rename_page(title change)
→ fractal::sync_project
→ read_project_with_active_page
→ setActiveProject(nextProject)
→ hasUnsavedPageChanges = false
```

Important: Amanite currently chooses to sync after saving, so generated links are refreshed after page saves.

### Edit unsaved page fields

```text
Editor component callback
→ session.updateActivePageTitle / BodyHtml / Summary / Tags
→ setActiveProject({...activeProject, changed field})
→ hasUnsavedPageChanges = true
```

Unsaved changes live in frontend state. Persistent truth comes back from Fractal after save.

### Add/update/delete note

```text
Editor note UI
→ session.add/update/deleteActivePageNote
→ withSavedPageIfNeeded
→ fractalClient.add/update/deleteNote
→ Tauri fractal_add/update/delete_note
→ fractal::add_note / patch_note / remove_note
→ fractal::sync_project
→ read_project_with_active_page
→ setActiveProject(nextProject)
```

### Create page

```text
Sidebar/FileExplorer
→ session.createProjectPage
→ fractalClient.createPage
→ Tauri fractal_create_page
→ create_project_page
→ fractal::create_page
→ read_project_with_active_page(created page)
```

### Rename page from sidebar

```text
Sidebar/FileExplorer rename dialog
→ session.renameProjectPage
→ fractalClient.renamePage
→ Tauri fractal_rename_page
→ rename_project_page
→ fractal::rename_page
→ read_project_with_active_page(new active path if needed)
```

### Delete page/folder

```text
Sidebar/FileExplorer delete action
→ session confirmation
→ fractalClient.deletePage/deleteDirectory
→ Tauri fractal_delete_page/delete_directory
→ fractal::delete_page/delete_directory
→ read_project or read_project_with_active_page
```

## Backend adapter map

`src-tauri/src/lib.rs` has five informal regions:

1. **DTO structs**: `FractalPage`, `FractalNote`, `FractalProject`, catalog/result structs.
2. **Project library helpers**: `projects_root`, `project_directory_name`, `selected_project_root`, `list_project_summaries`.
3. **View-model loaders**: `list_fractal_pages`, `list_fractal_directories`, `load_editor_page_detail`, `read_project_with_active_page`.
4. **Operation helpers**: `update_project_page`, page/folder create/delete/rename, note add/update/delete.
5. **Tauri commands**: `fractal_*` functions that mostly delegate to helpers.

When this file feels too large, do not rewrite it. First label which region you are in.

## Editor component map

```text
FractalEditor.tsx
  composition/root event capture
  owns inspector open state
  wires note/link interaction hooks

EditorCanvas.tsx
  LexicalComposer, toolbar, metadata editor, contenteditable, notes ledger

plugins/HtmlBridgePlugin.tsx
  bodyHtml <-> Lexical editor state bridge

plugins/EditorToolbar.tsx
  formatting toolbar and active-format state

PageMetadataEditor.tsx
  title/summary/tags UI

NotesLedger.tsx
  note list and inline note editing

NotePopover.tsx / NoteContextMenu.tsx
  floating note/link UI

InspectorPanel.tsx
  backlinks/outlinks/notes/link context display

useNoteInteractions.ts
  note popover/menu/editing state machine

useEditorLinkInteractions.ts
  click/hover/context-menu handling for generated links and selected text

useTagEditor.ts
  tag draft/input behavior
```

## Mental buckets for files

When opening a file, ask which bucket it is in:

1. **Boundary type/client** — `src/lib/fractal/*`.
2. **Session orchestration** — `src/app/useFractalSession.ts`.
3. **Shell UI** — `App`, `Workspace`, `Sidebar`, `FileExplorer`.
4. **Editor UI** — `features/editor/components/*`.
5. **Backend adapter** — `src-tauri/src/lib.rs`.
6. **Style only** — `src/styles/*`.

Do not judge a file until you know its bucket.

## First comprehension drill

Do not refactor. Do this once:

1. Pick one action: save page.
2. Start in `FractalEditor.tsx` and find `onSave`.
3. Jump to `useFractalSession.ts::saveActivePage`.
4. Jump to `client.ts::savePage`.
5. Jump to `src-tauri/src/lib.rs::fractal_update_page`.
6. Jump to `update_project_page` in the same Rust file.
7. Stop when it calls `fractal::update_editor_page` / `fractal::rename_page` / `fractal::sync_project`.

Write the trace down in 10 lines. That is your first mental route through Amanite.
