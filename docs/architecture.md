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

The optional right editor pane holds another Fractal page snapshot and draft in UI state. It uses the same `Project::write_page` boundary, autosave, and recovery-draft behavior as the primary page. Split and panel widths are presentation state only.

Amanite may keep a temporary browser-local copy of unsaved complete HTML for crash recovery. The copy is a recovery cache, not a project page or second page format. Amanite clears it after `Project::write_page` succeeds or after the user explicitly discards it. Appearance settings are also browser-local and do not enter the project.

Fractal does not model empty directories. Amanite lists and creates directories below `pages/` with validated relative paths. Folder deletion calls `Project::delete_page` for every contained page before Amanite removes the remaining directory.

The adapter exposes project list, create, and open operations. Page operations cover open, create, native-document import, write, move, delete, search, link insertion, derived links, suggestions, references, modification checks, and validation. Native import creates the destination through `Project::create_page_at` and writes it through `Project::write_page`. Amanite does not create raw HTML files because Fractal does not yet expose that operation.
