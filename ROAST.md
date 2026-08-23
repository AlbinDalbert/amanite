# Amanite code roast

Reviewed and remediated 2026-08-23 on `main` after the editor-group rewrite.

## Verdict

**The two-group editor now has one document model, and the dangerous HTML path has guardrails.**

The follow-up removed the old single-active-page state instead of teaching two save systems to cooperate. The workspace buffer map now owns drafts, dirty state, autosave, conflict checks, recovery, and writes. The remaining tradeoffs are explicit rather than accidental.

## Structure and maintainability

`useFractalSession` now owns the project catalog, project commands, confirmation dialogs, and command status. `useWorkspaceDocuments` is the sole owner of editable documents. Window-close handling registers one `saveAll` function from the workspace.

`docs/architecture.md` now describes the shared buffer map and independent editor groups. The retired primary-page and auxiliary-page model is gone from code and documentation.

No open structural finding remains from the previous roast.

## Correctness and data integrity

Rich-editor image and iframe nodes retain all source attributes through import, Lexical state, and HTML export. The live React view applies a safe rendering subset, and exported iframes always receive Amanite's restrictive sandbox. Tests cover `srcdoc`, dimensions, custom data attributes, and sandbox replacement.

Folder deletion remains sequential by design. The user accepted partial progress if a later page deletion fails, so this is recorded as product behavior rather than an open finding.

No open high-severity correctness finding remains from the previous roast.

## Tests and verification

- `pnpm test` passes 29 tests in 9 files.
- `pnpm run build` passes without the previous large-chunk warning.
- `cargo test --manifest-path src-tauri/Cargo.toml` passes 3 backend tests.
- `pnpm run tauri:webdriver:smoke` passes against the real Tauri app, including save, split groups, settings, buffer switching, and draft recovery.
- `git diff --check` passes.

The backend tests now cover relative page and folder paths plus project directory naming. The desktop smoke artifacts are under `artifacts/tauri-webdriver/2026-08-23T19-08-01-203Z/`.

## Failure handling and operability

Each document path now has one in-flight save promise. Autosave, keyboard saves, save-all, and close handling join that promise instead of starting overlapping writes.

The initial JavaScript chunk fell from 712.72 kB to 232.14 kB. Settings load as a 6.23 kB chunk, and the 471.56 kB workspace/editor chunk loads only after a project opens. Vite no longer emits its 500 kB warning.

The native window background, inline pre-JavaScript boot screen, and React lazy-loading fallback all use Amanite's dark background. Startup no longer depends on loaded CSS or JavaScript to cover the webview's white default.

## Security and trust boundaries

Rich-document iframes always render with `sandbox="allow-same-origin"`, which does not grant script execution. A source document cannot remove or widen that sandbox. Raw HTML previews remain sandboxed without script permission.

Page metadata and reveal commands now reject absolute and parent paths, canonicalize the target, and verify that it remains below the project's canonical `pages/` directory. Symlink escapes fail the same containment check.

The app still has `csp: null`. Sandboxing closes the concrete iframe execution path found in the roast, but an explicit CSP would add defense in depth if Amanite later gains another HTML rendering path.

## What was not verified

- Screen-reader output and complete keyboard focus behavior.
- High-DPI and non-Linux desktop startup behavior.
- Very large projects and documents.
