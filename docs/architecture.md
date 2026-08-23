# Architecture

Fractal owns project and page behavior. Amanite is only a desktop adapter.

```text
React UI
→ useFractalSession
→ src/lib/fractal/client.ts
→ Tauri commands
→ fractal::Project
→ refreshed FractalProject view model
```

The backend opens a fresh `fractal::Project` for each command and delegates mutations to its public methods. It does not maintain a second index or reproduce path, link, or validation rules.

For native `.fractal.html` documents, the frontend derives an editable title and body from `main[data-fractal-document]` and folds rich-editor changes back into the complete document. Ordinary `.html` files render in a sandboxed frame by default. Their source toggle exposes that same complete document for editing. Rendered internal links use Fractal's resolved targets to open another project page. Successful writes send complete HTML through Fractal and return a fresh project view. Page kinds, links, backlinks, iframes, and iframe backlinks are snapshots from that view.

Amanite may keep a temporary browser-local copy of unsaved complete HTML for crash recovery. The copy is a recovery cache, not a project page or second page format. Amanite clears it after `Project::write_page` succeeds or after the user explicitly discards it. Appearance settings are also browser-local and do not enter the project.

Fractal does not model empty directories. Amanite lists and creates directories below `pages/` with validated relative paths. Folder deletion calls `Project::delete_page` for every contained page before Amanite removes the remaining directory.

Supported UI operations are exactly those wired through the adapter: project list/create/open, page open/create/write/move/delete, and validation. Unsupported Fractal operations have no dormant command, DTO, or UI scaffold in Amanite.
