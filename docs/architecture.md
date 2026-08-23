# Architecture

Fractal owns project and page behavior. Amanite is a desktop adapter and editor.

```text
React UI
-> useFractalSession for project commands and catalog state
-> useWorkspaceDocuments for open document buffers
-> src/lib/fractal/client.ts
-> Tauri commands
-> fractal::Project
-> refreshed FractalProject snapshot
```

## Project and document ownership

`useFractalSession` owns the project catalog, the current project snapshot, command status, and confirmation dialogs. It does not own editable page state.

`useWorkspaceDocuments` is the only owner of open documents. Each path has one buffer containing complete HTML source, dirty and conflict state, the last known file modification time, references, and the current operation. Both editor groups point to these shared buffers. Opening the same page in both groups never creates a second draft.

The workspace saves buffers before project mutations and before closing the project. Window-close handling calls the workspace's `saveAll` function. Autosave and recovery drafts also operate on the same buffers. A per-path in-flight promise prevents overlapping writes.

## Persistence boundary

The backend opens a fresh `fractal::Project` for each command and delegates page mutations to its public methods. It does not keep another index or reproduce Fractal's page and link rules.

For native `.fractal.html` documents, the frontend reads the editable title and body from `main[data-fractal-document]`. It folds rich-editor changes back into the complete HTML document and writes that source through `Project::write_page`.

Ordinary `.html` files render in a sandboxed frame. Their source mode edits the same complete document. Successful writes return a fresh project snapshot with updated pages, links, backlinks, iframes, and modification time.

Recovery drafts contain complete HTML and live in browser-local storage. They are temporary crash recovery data, not another page format. Amanite removes a draft after a confirmed Fractal write or an explicit discard.

## Editor groups

The workspace has left and optional right editor groups. Each group owns its ordered tab paths, active path, and navigation history. Groups share the document buffer map, so dirty state and save conflicts belong to a path rather than a pane.

`workspaceGroups.ts` contains pure tab and history transitions. `EditorGroupPane.tsx` renders either group with the same component. The layout is intentionally limited to two columns; Amanite does not carry a general docking tree.

## HTML safety

Raw HTML previews run without script permission. Iframes embedded in native rich documents always receive Amanite's restrictive sandbox when rendered and saved. Media nodes retain their source attributes for round-trip fidelity, but the live React view only applies attributes that are safe and useful for rendering.

## Folders and filesystem paths

Fractal does not model empty directories. Amanite lists and creates directories below `pages/` with validated relative paths. Folder deletion calls `Project::delete_page` for contained pages before removing the remaining directory.

Commands that inspect or reveal a page canonicalize the target and verify that it remains below the project's canonical `pages/` directory. Project roots may still live outside Amanite's default library when the user opens them explicitly.
