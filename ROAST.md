# Amanite and Fractal review

> Historical review from before the native v2 trust work. The active roadmap is
> [`docs/amanite-native-v2-plan.md`](docs/amanite-native-v2-plan.md).

Reviewed 2026-09-03 against Amanite `0afae9a`, its locked Fractal dependency `1974c93`, and Fractal `ba5cabf`.

## Verdict

Amanite has crossed out of prototype territory. The persistence design is thoughtful, the real desktop smoke test covers meaningful behavior, and the folder view gives the product a character that Obsidian does not have by default.

It is not ready to ask for unconditional trust yet. The remaining problems sit exactly where users notice them most: recovery storage is best effort, some mutations make the frontend guess what Fractal did, opening a project can silently rename or rewrite files, and the Fractal revision currently locked by Amanite predates a known folder-rename transaction fix.

The next Amanite release should be a trust release, not another editor-feature release. Fractal can remain on an explicitly unstable v2 contract while that work happens. Its larger direction is dependable conversion into and out of Fractal projects, with validation and clear reports whenever a conversion cannot preserve something.

## Structure and maintainability

The main ownership split is sound. Fractal owns files, validation, graph derivation, and mutations. Amanite owns editor buffers, save timing, recovery prompts, and presentation. One buffer per page across both editor groups is the right model.

### Medium: mutation outcomes are inferred instead of returned as receipts

Several Amanite flows compare snapshots or reuse user input to infer renamed paths. `Workspace.tsx` uses the requested destination after a page move even though Fractal may normalize it. Folder rename reconciliation searches for a matching title and reconstructs descendant paths.

Smallest fix: make every Fractal mutation return a typed receipt with changed paths, deleted paths, old-to-new path mappings, committed hashes, and repairs. Have Amanite apply that receipt instead of rediscovering the result.

### Low: the Tauri adapter has become a second application layer

`src-tauri/src/lib.rs` is 1,516 lines and owns catalog scanning, filesystem policy, import orchestration, AI HTTP calls, platform integration, DTO conversion, and command registration. It is still readable, but ownership is getting muddy.

Smallest fix: split only the filesystem/catalog and AI adapter code. Keep Fractal command wrappers direct.

## Correctness and data integrity

### High: Amanite ships a Fractal revision from before the folder transaction fix

`src-tauri/Cargo.lock` pins Fractal at `1974c93`. That revision renames a folder first, then rewrites pages and metadata one by one. Its rollback only renames the directory back, so a later write failure can leave earlier rewrites committed. Fractal `ba5cabf` replaces this with the recoverable transaction path.

Smallest fix: update Amanite to a tested Fractal commit before trusting folder rename. Tracking `main` is reasonable during active development, but every distributed Amanite build should identify and test its exact Fractal revision.

### Medium: project open is a hidden mutation

`Project::open` calls `repair_title_paths`, and folder loading appends newly discovered children to stored order files. Opening after an external rename can therefore rename files and rewrite links before Amanite shows the project.

Smallest fix: keep transaction recovery automatic, but make title and order repair an explicit inspected operation. If automatic repair remains, return and display an open report listing every file changed.

### Medium: page move can desynchronize tabs and buffers

Fractal accepts convenient destinations and normalizes suffixes and prefixes. `Workspace.tsx` renames tabs, buffers, and reloads with the unnormalized destination supplied by the user.

Smallest fix: use the resulting active path or, preferably, the mutation receipt. Test omitted suffixes and a leading `pages/`.

### Medium: the advertised missing-file recovery action cannot recreate the file

Polling labels a deleted open file as conflicted and offers `Replace disk`. Both native force-save and raw writes expect the page to exist, so the action fails in the case where it is needed most.

Smallest fix: show `Recreate page` for a missing target and add a create-from-buffer operation guarded by the last known page identity.

### Medium: recovery drafts are silent best effort

Drafts live in webview `localStorage`. Full, unavailable, cleared, or migrated storage makes writes disappear without telling the user. This is acceptable as a convenience cache, not as the final crash-recovery story for long unsaved sessions.

Smallest fix: atomically store recovery files in native app data with the base page hash and timestamp. Surface recovery health in the UI. They can remain temporary and do not need to become a second project format.

## Tests and verification

Current results:

- 67 frontend tests pass across 19 files.
- The production frontend build passes.
- 9 Amanite Rust tests pass.
- 59 tests pass in the current Fractal checkout.
- The real Tauri WebDriver smoke flow passes editing, saving, conflicts, split panes, folder editing, and draft recovery.
- Amanite Clippy fails on `large_enum_variant` and `items_after_test_module`.
- The desktop process prints `free(): corrupted unsorted chunks` after the smoke flow.
- Amanite has no checked-in CI workflow.

The smoke test is unusually useful, but it is one broad happy path. It does not prove power-loss durability, repeated crash recovery, large projects, upgrade compatibility, move normalization, missing-file recreation, or packaged builds on all supported platforms.

Smallest fix: add CI for the existing checks, resolve the allocator message, then build a small reliability matrix with fault injection at write and rename boundaries. Keep permanent v1 fixtures and representative v2 fixtures so contract changes are intentional and visible even before v2 stabilizes.

## Failure handling and operability

Normal concurrent editing is handled well. Section hashes allow disjoint native edits to merge, stale writes become visible conflicts, and save queues keep revisions that arrive during an in-flight write.

What is missing is an inspectable account of what happened. There is no project health view, durable recovery inventory, recent mutation journal, backup workflow, or one-click verification after a suspicious shutdown. A user sees small save markers and transient notices but cannot ask, "Are all of my files safe right now?"

Smallest fix: add a project health panel backed by Fractal. It should report format version, validation state, pending recovery drafts, last successful save, unfinished transaction recovery, and changed paths from the last mutation. This is more valuable now than another editor tool.

## Security and trust boundaries

Raw previews and native iframes are sandboxed, file paths are mostly contained, and AI reads are limited to the current catalog. Those are good boundaries.

### Medium: the AI key and app origin need hardening

The API key is persisted in `localStorage`, and Tauri CSP is disabled. A future frontend injection would be able to read a paid credential.

Smallest fix: move the key to the OS keychain or require it per session, and add a tested CSP before expanding Borealis to write tools.

## Product direction

Fractal is the main adoption product. It should become dependable conversion software for structured documents and projects. Importers should produce valid Fractal candidates plus a loss report. Exporters should derive target files without changing the source project. Each format needs an explicit promise such as lossless, structure-preserving, or best effort.

Do not begin with a universal converter framework. Implement two meaningfully different importers and exporters as direct engine operations, learn which concepts actually repeat, then extract the shared conversion types. Project-level assets, links, metadata, ordering, and unsupported constructs matter more than converting isolated text.

Amanite is Fractal's reference application and proving ground. Its job is to make validation, recovery, conversion previews, and conversion reports understandable while remaining a strong editor. The folder view is still an important Amanite idea because it demonstrates Fractal's ordered project model, but Amanite does not need to compete for Obsidian users.

Internal migrations between Fractal contract versions belong after a contract is ready to stabilize. During v2 development, permanent fixtures and explicit breaking-change notes are enough. Borealis should remain read-only until the trust work lands, then begin with cited suggestions and reviewable patches rather than invisible direct edits.
