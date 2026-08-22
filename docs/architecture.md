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

For a native document, the frontend derives an editable title and body from the required `main[data-fractal-document]` root. Rich-editor changes are folded back into the complete document kept in React state. Raw HTML bypasses the rich editor and uses an explicit source editor because Fractal treats that source as author-owned. Successful writes send complete HTML through Fractal and return a fresh project view. Page kinds, links, backlinks, iframes, and iframe backlinks are snapshots from that view.

Supported UI operations are exactly those wired through the adapter: project list/create/open, page open/create/write/move/delete, and validation. Unsupported Fractal operations have no dormant command, DTO, or UI scaffold in Amanite.
