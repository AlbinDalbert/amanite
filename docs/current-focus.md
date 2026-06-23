# Amanite Current Focus

This is the short working-memory page for when the project feels too large. If you are not sure what exists, read [`feature-inventory.md`](feature-inventory.md). If the product makes sense but the code does not, read [`code-map.md`](code-map.md) next.

## What Amanite is

Amanite is the desktop editor for Fractal projects.

It owns:

- project library/open/create UI;
- workspace layout;
- page navigation;
- rich editor interactions;
- note/link/inspector presentation;
- Tauri commands that adapt the frontend to the Fractal crate.

It does not own the Fractal document format. Durable rules for paths, titles, links, validation, generated data, mutation safety, and graph/index behavior belong in Fractal.

## Current phase

Keep Amanite thin over Fractal.

The editor decomposition pass mostly happened already. The current problem is cognitive/architectural drift: make sure future UI work does not duplicate engine rules or turn the Tauri adapter into a second Fractal implementation.

Normal flow:

```text
React UI event
→ useFractalSession
→ src/lib/fractal/client.ts
→ Tauri command
→ Fractal crate API
→ refreshed FractalProject view model
```

## What is already basically done

- Tauri/React/Lexical desktop shell.
- Project create/open/list flows.
- Page create/open/save/rename/delete flows.
- Directory create/delete flows.
- Note add/edit/delete flows.
- Validation and index build commands.
- Real Tauri WebDriver debug harness.
- Editor split into canvas, metadata, toolbar, note UI, inspector, bridge, and interaction hooks.

## Do next

0. Read [`feature-inventory.md`](feature-inventory.md) once to reset what the app actually supports.

0.5. Build code familiarity by tracing one real flow in [`code-map.md`](code-map.md). Do not refactor during this pass.

1. Keep new Fractal rules out of Amanite. If a rule affects project validity or persistence, move/expose it in Fractal.

2. Decide whether `src-tauri/src/lib.rs` is painful enough to split. If yes, split by responsibility only:
   - `catalog.rs`
   - `view_model.rs`
   - `page_ops.rs`
   - `note_ops.rs`
   - thin command registration/wrappers

3. Add one focused WebDriver smoke path for an editor mutation flow.

4. Narrow broad `isBusy` usage only where it makes the UI clearer without allowing unsafe overlapping mutations.

5. Later: return richer operation/report data to the frontend instead of mostly string command details.

## Do not do yet

- Do not add a global state library unless session props actually become painful.
- Do not build a frontend domain model separate from Fractal DTOs without a real mismatch.
- Do not implement Fractal path/title/link validation in TypeScript as a second source of truth.
- Do not split files just to make them smaller if the split makes flow harder to follow.

## Done for this phase means

- `README.md`, `docs/architecture.md`, `docs/todo.md`, and this file agree.
- Fractal remains the only source of durable project/document rules.
- Tauri commands are thin enough to safely change.
- At least one representative editor mutation path has desktop smoke coverage.
- `pnpm build` passes, and the WebDriver smoke command passes when a valid debug build exists.
