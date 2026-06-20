# Amanite TODO / Technical Debt

## Editor decomposition

`src/features/editor/components/FractalEditor.tsx` is still the largest frontend debt pocket. It currently owns Lexical setup, HTML import/export, toolbar state, page metadata editing, tags, note popovers, note context menus, hover previews, inspector data, and shell layout.

Refactor this in a focused editor-only pass, preserving behavior and validating with the Tauri WebDriver harness.

Suggested extraction plan:

- `editorLexicalTheme.ts` — Lexical theme object and editor constants.
- `editorHtml.ts` — HTML import/export helpers and text truncation helpers where appropriate.
- `plugins/HtmlBridgePlugin.tsx` — body HTML <-> Lexical state sync.
- `plugins/EditorToolbar.tsx` — toolbar UI and active-format tracking.
- `PageMetadataEditor.tsx` — title, summary, tags, dirty/save controls.
- `TagEditor.tsx` — tag draft parsing and keyboard behavior.
- `NotePopover.tsx` — note/page preview, detail, create, and edit popovers.
- `NoteContextMenu.tsx` — selected-text note creation menu.
- `InspectorPanel.tsx` — backlinks, outlinks, notes, and page-link sections.
- `editorGeometry.ts` — floating popover/menu positioning helpers.
- `editorText.ts` — compact/truncate/comparison helpers.

Acceptance criteria:

- `FractalEditor.tsx` becomes primarily composition and top-level event orchestration.
- No behavior changes to note creation/edit/delete, hover previews, page navigation, save dirty state, or Lexical formatting.
- `pnpm build` passes.
- `pnpm run tauri:webdriver:smoke -- --skip-build` passes after a valid WebDriver debug build exists.

## Follow-ups

- Continue replacing broad `isBusy` props with operation-specific flags where components can allow safe parallel interaction.
- Add focused tests or WebDriver smoke coverage for editor note flows and page mutation flows.
- Run a bundle visualizer before adding heavier editor dependencies.
