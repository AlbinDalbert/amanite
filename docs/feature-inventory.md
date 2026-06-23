# Amanite Feature Inventory

Status: current code inventory, 2026-06-23. This answers: "what does this app actually support today?" It is based on the React/Tauri code paths, not aspirational product direction.

Legend:

- **Landed**: implemented in current UI/backend paths.
- **Partial**: works, but rough or missing richer UX/reporting/coverage.
- **Backend-only**: exposed through Tauri/backend or Fractal but not first-class UI.

## Project library and startup

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Resolve Amanite project library | Landed | app startup | `projects_root` | `src-tauri/src/lib.rs` | Uses `AMANITE_PROJECT_ROOT` when set; otherwise app data dir `projects`. |
| List existing projects | Landed | `StartScreen` refresh/list | `fractal_list_projects`, `list_project_summaries` | `src/app/useFractalSession.ts`, `src-tauri/src/lib.rs` | Lists child directories with `fractal.json`. |
| Create project | Landed | `StartScreen` create form | `fractal_create_project`, `create_project_in_library` | `src-tauri/src/lib.rs` | Creates Fractal project and initial Amanite page if needed. |
| Open project | Landed | `StartScreen` project list | `fractal_open_project`, `read_project` | `src-tauri/src/lib.rs` | Loads pages/directories and active page view model. |
| Empty project fallback | Landed | open/create flows | `create_initial_amanite_page` | `src-tauri/src/lib.rs` | Amanite creates an initial page for page-less Fractal projects. |

## Workspace and navigation

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Workspace shell | Landed | `Workspace` | none | `src/features/workspace/components/Workspace.tsx` | Sidebar + toolbar + status + editor stage. |
| File/page tree | Landed | `Sidebar`, `FileExplorer` | view model from backend | `src/features/workspace/components/FileExplorer.tsx` | Builds tree from `pages` and `directories`. |
| Open page | Landed | click page in sidebar/tree | `fractal_open_page`, `read_project_with_active_page` | `useFractalSession.ts`, `src-tauri/src/lib.rs` | Prompts before discarding unsaved changes. |
| Command/status display | Landed | toolbar/context actions | command result state | `CommandStatus.tsx`, `App.tsx` | Shows errors and simple command messages. |
| Global context menu actions | Partial | right-click app wrapper | calls session methods | `src/components/ui/UniversalContextMenu.tsx`, `App.tsx` | Save, validate, build index. |

## Page management

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Create page | Landed | sidebar/file tree create page | `fractal_create_page`, `create_project_page` | `useFractalSession.ts`, `src-tauri/src/lib.rs` | Creates through Fractal crate, opens created page. |
| Rename/move page path | Landed | sidebar/file tree rename | `fractal_rename_page`, `rename_project_page` | `src-tauri/src/lib.rs` | Calls `fractal::rename_page`; opens new path if active page moved. |
| Delete page | Landed | sidebar/file tree delete | `fractal_delete_page`, `delete_project_page` | `src-tauri/src/lib.rs` | Keeps/open remaining page; prevents empty-project edge cases with fallback behavior. |
| Create directory | Landed | sidebar/file tree create folder | `fractal_create_directory`, `create_project_directory` | `src-tauri/src/lib.rs` | Calls Fractal directory API. |
| Delete directory | Landed | sidebar/file tree delete folder | `fractal_delete_directory`, `delete_project_directory` | `src-tauri/src/lib.rs` | Deletes recursively through Fractal; prevents deleting all pages from UI. |

## Editor and page mutation

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Rich body editing | Landed | Lexical editor | saved via `fractal_update_page` | `EditorCanvas.tsx`, `HtmlBridgePlugin.tsx` | Body HTML bridges between Fractal and Lexical. |
| Title editing | Landed | metadata header | `update_project_page` -> `fractal::rename_page` when changed | `PageMetadataEditor.tsx`, `src-tauri/src/lib.rs` | Title changes may rename/move page according to Fractal. |
| Summary editing | Landed | metadata editor | `fractal::update_editor_page` | `PageMetadataEditor.tsx` | Saved with page. |
| Tag editing | Landed | metadata editor | `fractal::update_editor_page` | `useTagEditor.ts`, `PageMetadataEditor.tsx` | Draft tag UI, normalized by Fractal. |
| Save page | Landed | Ctrl+S/context/save action | `fractal_update_page`, `update_project_page` | `useFractalSession.ts`, `src-tauri/src/lib.rs` | Saves body/summary/tags, maybe renames title, then syncs project links. |
| Dirty-state tracking | Landed | session state | none | `useFractalSession.ts` | Unsaved changes live in frontend until save. |
| Inspector panel | Landed | editor inspect toggle | active page view model | `InspectorPanel.tsx` | Shows backlinks/outlinks/notes/page links from backend data. |

## Notes and generated links

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Add note from selected text/context | Landed | editor context menu/popover | `fractal_add_note`, `add_project_note` | `useNoteInteractions.ts`, `NoteContextMenu.tsx`, `src-tauri/src/lib.rs` | Saves page first if needed, adds note, syncs links. |
| Edit note | Landed | note popover / notes ledger | `fractal_update_note`, `update_project_note` | `NotesLedger.tsx`, `NotePopover.tsx` | Patches note and syncs links. |
| Delete note | Landed | note popover / notes ledger | `fractal_delete_note`, `delete_project_note` | `NotesLedger.tsx`, `NotePopover.tsx` | Removes note and syncs links. |
| Hover/click generated links | Landed | editor interactions | frontend active page data | `useEditorLinkInteractions.ts`, `useNoteInteractions.ts` | Navigates page links, opens note/page hover/detail UI. |
| Generated-link sync after saves/note mutations | Landed | save/note flows | `fractal::sync_project` | `src-tauri/src/lib.rs` | Amanite chooses to sync after saves and note mutations. |

## Project commands

| Capability | Status | Frontend entry | Tauri command/helper | Main code | Notes |
|---|---:|---|---|---|---|
| Validate project | Landed | toolbar/context action | `fractal_validate_project` | `App.tsx`, `src-tauri/src/lib.rs` | Returns simple `FractalCommandResult`; not rich structured UI yet. |
| Build index | Landed | toolbar/context action | `fractal_build_index` | `App.tsx`, `src-tauri/src/lib.rs` | Rebuilds generated index/graph through Fractal. |
| Show mutation reports | Partial | command status only | simple string result | `CommandStatus.tsx`, `src-tauri/src/lib.rs` | Rich `OperationReport` not surfaced deeply in UI yet. |

## Desktop debugging and build

| Capability | Status | Entry | Main code | Notes |
|---|---:|---|---|---|
| Vite frontend dev | Landed | `pnpm run dev` | `vite.config.ts` | Frontend-only; no real Fractal access outside Tauri. |
| Tauri desktop dev | Landed | `pnpm run tauri:dev` | Tauri config | Real backend. |
| WebDriver desktop smoke/open | Landed | `pnpm run tauri:webdriver:*` | `scripts/tauri-desktop-debug.mjs` | Preferred UI behavior debugging path. |
| Production build | Landed | `pnpm run build`, `pnpm run tauri:build` | package scripts | Frontend build + Tauri build. |

## Current user-visible limitations

| Area | Current limitation |
|---|---|
| Fractal rules | Amanite intentionally delegates durable validation/path/link rules to Fractal. |
| Error UX | Errors are mostly strings from Tauri helpers, not rich typed UI states. |
| Operation reports | The UI does not expose full Fractal `OperationReport` data yet. |
| Busy state | Session has operation-specific busy state, but many components still receive broad `isBusy`. |
| WebDriver coverage | Harness exists, but editor mutation coverage should be expanded. |
| Import/export | Fractal has markdown stubs, but Amanite does not expose import/export UI as first-class flows. |
| Search/graph exploration | Fractal has search/graph APIs, but Amanite currently shows only active-page links/backlinks/outlinks/notes. |
| Settings/theme/user prefs | Not a first-class feature yet beyond project/theme data from Fractal. |

## What this app does not currently try to be

- A standalone knowledge engine separate from Fractal.
- A generic arbitrary-HTML editor.
- A full graph visualization app.
- A mature import/export UI.
- A multi-pane/advanced workspace manager.
- A replacement for Fractal CLI/API machine workflows.
