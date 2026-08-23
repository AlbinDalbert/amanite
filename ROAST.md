# Amanite UX roast

Reviewed and rechecked 2026-08-23 after the workspace rewrite.

## Verdict

**Two real editor groups. The fake subsystem is gone.**

Amanite now has a coherent desktop editing model. The left and right groups own separate ordered tab lists, active pages, and histories. Commands follow the focused group. Dirty state, save errors, and disk conflicts belong to documents rather than a global primary-versus-secondary split.

The core desktop UX can reasonably be called complete. The remaining work is polish and broader accessibility verification.

## What works

- Tabs reorder within a group and move between groups. Dragging a tab to the right creates the second group.
- Quick open, sidebar navigation, links, back and forward, Ctrl/Cmd+W, and reopen-closed target the focused group.
- Each open file has one shared buffer with source, dirty state, revision, modified time, operation, and error data.
- Settings leave the workspace mounted, so opening preferences does not destroy the group layout.
- Dirty tabs survive navigation. Ctrl/Cmd+S saves the focused document, while the top button becomes "Save all" when several files are dirty.
- Each document checks its disk modified time before writing. A conflict appears in the affected group with explicit reload and replace actions.
- Project moves and deletions reconcile the group tabs and buffers with Fractal's returned project state.
- The inspector no longer renders a tower of empty cards. Empty reference categories collapse into one line.
- Subtle metadata text has stronger contrast, and the smallest file-kind label grew from 0.52 rem to 0.6 rem.

## Structure and maintainability

The old `secondaryProject` branch and second save implementation are gone. `workspaceGroups.ts` contains the pure two-group transitions. `useWorkspaceDocuments.ts` owns document I/O and buffer state. `EditorGroupPane.tsx` renders either group through the same component.

This stays within KISS and YAGNI. Amanite supports two columns because that is the requested workflow. It does not carry a recursive layout tree or a general docking framework.

No open structural finding remains from the original roast.

## Correctness and data integrity

The desktop smoke test now edits a right-group document, changes the same file outside Amanite, waits for the per-document conflict warning, and reloads the disk version. Saves run sequentially, so several dirty buffers cannot race project snapshots.

Drafts remain complete HTML and persistence still goes through `fractal::Project::write_page`. The rewrite did not add another durable page format.

No open high-severity correctness finding remains from the original roast.

## Tests and verification

Checks run:

- `pnpm test`, 23 tests in 7 files passed.
- `pnpm run build`, TypeScript and Vite passed.
- `pnpm run tauri:webdriver:doctor`, passed.
- `pnpm run tauri:webdriver:smoke`, passed against the real Tauri binary.
- `git diff --check`, passed.

The group tests cover independent tabs and histories, cross-group moves, splitting the only left tab, nearest-neighbor close behavior, group collapse, path renames, and deletion reconciliation.

The desktop smoke run creates at least four left tabs and two right tabs, drags tabs into the right group, detects a right-page disk conflict, verifies right-focused Ctrl/Cmd+W, reopens the closed tab in the right group, preserves a dirty buffer across tab switches, and recovers a draft. Artifacts are under `artifacts/tauri-webdriver/2026-08-23T17-46-57-571Z/`.

## Failure handling and operability

Tabs show saved, dirty, and conflict states. The focused group has its own visual edge and toolbar readout. Save failures and disk conflicts appear beside the affected editor. Reload and forced replacement require separate explicit actions.

Tab rails scroll horizontally instead of clipping unreachable documents. Arrow keys move between tabs. Alt+Shift+Left and Alt+Shift+Right reorder the focused tab within its group.

The production bundle still produces a Vite warning for a roughly 709 kB JavaScript chunk. This is not a current desktop interaction failure, but it is worth measuring before the app gains more large dependencies.

## Security and trust boundaries

File persistence stays behind Tauri commands and the `fractal::Project` API. Page and folder deletion still require confirmation. The new modified-time preflight closes the credible trust gap from the old right pane.

No new security finding surfaced in this pass.

## What was not verified

- Screen reader output in the Tauri webview.
- High-DPI behavior outside the captured desktop environment.
- Projects with hundreds of pages.
- Restoring the full two-group layout after quitting the app. Session restore still reopens the last project and page, not every open tab.
