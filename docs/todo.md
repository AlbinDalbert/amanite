# Amanite TODO / Technical Debt

Status: refreshed 2026-06-23. The old giant-editor-decomposition item is no longer the main architecture problem: `FractalEditor.tsx` is now mostly composition, with editor canvas, metadata, inspector, note UI, interaction hooks, and Lexical bridge pieces split out.

## Current architectural rule

Fractal owns project/document truth. Amanite presents and edits it through the Tauri backend. Start with [`current-focus.md`](current-focus.md) for the shortest working-memory version, [`feature-inventory.md`](feature-inventory.md) for current supported capabilities, [`code-map.md`](code-map.md) for practical code navigation, and [`architecture.md`](architecture.md) for the current KISS boundaries.

## Highest-priority cleanup

### 1. Keep the Tauri backend adapter boring

`src-tauri/src/lib.rs` is the largest current pressure point. It is mostly adapter/view-model glue, not bad domain code, but it is broad enough that future changes may become risky.

Suggested split if it starts hurting:

- `catalog.rs` — project library discovery, project root resolution, create/open helpers.
- `view_model.rs` — mapping Fractal crate data into frontend `FractalProject` DTOs.
- `page_ops.rs` — page and directory command helpers.
- `note_ops.rs` — note command helpers.
- `commands.rs` or `lib.rs` — thin Tauri command wrappers and registration.

Acceptance criteria:

- Tauri command functions stay thin.
- Fractal rules remain in the Fractal crate.
- The frontend DTO shape remains easy to inspect.
- No behavior changes to project open/create, page save, page rename/delete, directory management, or note flows.

### 2. Update stale docs as part of refactor passes

Recent editor cleanup outpaced the docs. Treat stale docs as architectural debt because they make the system feel more chaotic than it is.

Acceptance criteria:

- `README.md`, this TODO, and [`architecture.md`](architecture.md) agree on the current boundaries.
- Any future major cleanup updates docs before being considered finished.

### 3. Replace global busy gating where it blocks safe interactions

`useFractalSession` already has operation-specific busy state internally, but many components still receive broad `isBusy` props. Keep broad gating where it protects project integrity; narrow it where the UI could safely continue.

Possible examples:

- allow reading/sidebar inspection during non-conflicting commands;
- keep save/page/note mutations serialized;
- avoid disabling unrelated UI during validation/index-only operations when safe.

Acceptance criteria:

- Busy state communicates what is actually blocked.
- Save/page/note mutation flows remain safe.
- UI does not feel frozen during harmless project commands.

### 4. Add focused smoke coverage for editor mutation flows

The WebDriver harness exists and should remain the default for desktop UI behavior checks.

Good next smoke targets:

- create/open project with initial page fallback;
- edit title/body/summary/tags and save;
- create/edit/delete note;
- create/rename/delete page;
- create/delete folder with nested pages;
- validate/build-index command status.

Acceptance criteria:

- `pnpm build` passes.
- `pnpm run tauri:webdriver:smoke -- --skip-build` covers at least one representative editor mutation path after a valid WebDriver debug build exists.

## Completed / downgraded debt

### Editor decomposition

The previous TODO said `FractalEditor.tsx` owned Lexical setup, HTML import/export, metadata editing, tags, note popovers, context menus, hover previews, inspector data, and shell layout. That is no longer accurate.

Already extracted or separated:

- `EditorCanvas.tsx`
- `plugins/HtmlBridgePlugin.tsx`
- `plugins/EditorToolbar.tsx`
- `PageMetadataEditor.tsx`
- `NotesLedger.tsx`
- `NotePopover.tsx`
- `NoteContextMenu.tsx`
- `InspectorPanel.tsx`
- `editorGeometry.ts`
- `editorHtml.ts`
- `editorLexicalTheme.ts`
- `editorLinks.ts`
- `editorText.ts`
- `editorTypes.ts`
- `useEditorLinkInteractions.ts`
- `useNoteInteractions.ts`
- `useTagEditor.ts`

Remaining editor work should be behavior-driven, not decomposition for its own sake.

## Follow-ups

- Keep Amanite-side path/title/link logic minimal; push durable rules into Fractal.
- Consider returning richer command/report data from Tauri instead of mostly string `FractalCommandResult` details.
- Run a bundle visualizer before adding heavier editor dependencies.
