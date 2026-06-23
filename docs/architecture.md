# Amanite Architecture

Status: current working architecture, 2026-06-23. This is a KISS boundary document, not a request for more framework.

## Core rule

Fractal owns truth. Amanite presents and edits that truth.

Amanite should not duplicate Fractal's page format, graph rules, path validation, generated-data contract, or persistence semantics. When in doubt, push the rule down into the Fractal crate and expose it through the Tauri backend.

The normal app flow is:

```text
React UI event
→ useFractalSession orchestration
→ src/lib/fractal/client.ts typed frontend adapter
→ Tauri command
→ Fractal crate API
→ refreshed FractalProject view model
```

## Layers

- `src/app/` owns app-level orchestration, active project/session state, command status, confirmation flow, and top-level routing between start screen and workspace.
- `src/lib/fractal/` is the frontend boundary to the backend. It contains TypeScript DTOs and Tauri invocation wrappers. React feature components should talk to this adapter, not directly to Tauri.
- `src/features/project-open/` owns project catalog/create/open UI.
- `src/features/workspace/` owns shell layout around an open project: sidebar, file explorer, toolbar, status, and editor stage.
- `src/features/editor/` owns rich editor UI and interactions. It may know editor body HTML, notes, links, metadata, and navigation callbacks, but it should not implement Fractal persistence rules.
- `src/components/ui/` contains reusable primitives that are not Fractal-domain features.
- `src-tauri/` is the desktop/backend adapter. It maps frontend commands to Fractal crate calls and builds the `FractalProject` view model consumed by the frontend.

## Backend adapter rules

`src-tauri/src/lib.rs` is currently the largest pressure point. It is acceptable adapter glue, but it should stay boring:

1. Resolve Amanite project-library concerns.
2. Call Fractal crate APIs for project/page/note operations.
3. Translate Fractal structs into frontend DTOs.
4. Return refreshed project state after mutations.
5. Avoid implementing Fractal rules that belong in the engine.

If this file is split, split by responsibility rather than pattern name:

```text
src-tauri/src/catalog.rs     project library discovery/create/open helpers
src-tauri/src/view_model.rs  FractalProject DTO mapping/loading
src-tauri/src/page_ops.rs    page/directory commands
src-tauri/src/note_ops.rs    note commands
src-tauri/src/commands.rs    tauri command registration or thin command wrappers
```

Do not introduce that split until it makes the file easier to change.

## Frontend state rules

- `useFractalSession` owns async orchestration and dirty-state decisions.
- Feature components should receive explicit props/callbacks and remain mostly presentational/interactive.
- Keep unsaved editor changes in the frontend until save; after save, trust the backend's returned `FractalProject`.
- Operation-specific busy flags are preferable to a single global lock when the UI can safely allow parallel interactions.
- Confirmation prompts live at app/session level, not inside low-level components.

## Editor boundary

The editor may:

- edit page title, summary, tags, and body HTML;
- render Fractal notes, generated links, backlinks, and outlinks;
- provide note creation/edit/delete UI;
- navigate to known page links.

The editor should not:

- write files directly;
- infer or validate Fractal page structure itself;
- rebuild indexes/graphs;
- duplicate path/title/link collision rules from Fractal.

## KISS pressure valves

- No global state library unless prop/session state becomes demonstrably painful.
- No frontend domain model separate from Fractal DTOs until there is a real mismatch.
- No generic command bus; explicit client methods are easier to inspect.
- Keep Tauri commands thin and named after user-visible operations.
- Prefer a small adapter split over introducing backend framework layers.

## Current architecture risks

- `src-tauri/src/lib.rs` is broad and may become harder to safely change as commands grow.
- `useFractalSession` is doing many orchestration jobs; it is okay for now, but should not absorb editor internals.
- Existing docs/todos can lag behind the code after refactor passes; update docs as part of finishing those passes.
- Amanite can easily drift into owning Fractal rules. Treat that as the main architectural smell.
