# Amanite repo roast

Reviewed 2026-09-06 at `2d7325c`. The findings below were the pre-fix baseline. The current working tree includes fixes for the highest-risk save, editor-preservation, recovery, blocking, and link-matching issues.

Amanite has a sensible persistence boundary and a much less convincing editor boundary. Fractal owns durable writes, locking, hashes, and transaction recovery. Good. Above that, the app sometimes forgets what it has saved, accepts markup it cannot preserve, and repeatedly processes entire projects to answer small questions. The README's reliability promises are ahead of the implementation.

Priority order: prevent content loss, fix save/recovery semantics, remove synchronous filesystem commands, then reduce repeated parsing and editor work. Deleting a few unused helpers will not cure this app's expensive habits.

## Correctness and data integrity

### High: the protection check approves content the editor deletes

[`editorHtml.ts:6`](src/features/editor/components/editorHtml.ts#L6) permits `caption`, `time`, `datetime`, and other markup without matching preservation support in the [registered Lexical nodes](src/features/editor/components/RichDocumentEditor.tsx#L133).

An isolated round trip using the installed Lexical importer/exporter and the relevant registered nodes removed an entire `<caption>Important caption</caption>`. It also converted `<time datetime="2026-09-06">Sunday</time>` into plain text. Both pass the compatibility allowlist. Editing elsewhere and saving exports the lossy representation through [HtmlBridgePlugin](src/features/editor/components/HtmlBridgePlugin.tsx#L30).

Smallest fix: restrict editable markup to what actually survives round trips. Add preservation tests before widening that list. A guard that says "safe" while deleting captions is worse than a missing feature.

### High: a multi-section save can silently waive conflict protection

[`documentPersistence.ts:74`](src/features/workspace/documents/documentPersistence.ts#L74) writes title before content, then replaces all section hashes with the title mutation's returned snapshot. If another program changed the body since this buffer was loaded, the title write can succeed and return that external body's hash. Amanite then uses the new hash to overwrite the body with local content, without reporting the original conflict.

An isolated probe of the actual persistence function confirmed that an original `content-old` baseline became `external-content` in the next write's expected hash. This was a mocked command-boundary reproduction, not an external-editor desktop test.

Smallest fix: preserve the original expected hashes for sections still awaiting a write. Update paths and hashes only where the preceding mutation justifies it.

### High: partial saves lose their committed progress

The same [section loop](src/features/workspace/documents/documentPersistence.ts#L74) returns a bare conflict or throws if a later section fails. Earlier receipts, new paths, and saved hashes never reach buffer reconciliation. A successful title rename followed by a failed content write leaves the buffer pointing at the old, nonexistent filename. The isolated probe confirmed this stale path.

Smallest fix: reconcile each committed section immediately, or return partial progress with the failure. Keep only unsaved sections pending. Do not present a partly committed rename as an ordinary failed save.

### High: closing a tab can discard edits that arrived during a save

[`saveDocument()`](src/features/workspace/documents/documentPersistence.ts#L204) returns `true` even when the buffer still contains newer dirty edits. The [first persistence test](src/features/workspace/documents/documentPersistence.test.ts#L59) explicitly asserts this behavior. [`closeTab()`](src/features/workspace/components/Workspace.tsx#L190) awaits that result and then forgets the buffer without checking it again. A slow autosave followed by more typing and tab close provides a credible path. Recovery drafts may help, but they are delayed and are not a substitute for saving.

There is another shutdown gap: [HTML export waits 120 ms](src/features/editor/components/HtmlBridgePlugin.tsx#L16), while [native window close](src/app/App.tsx#L131) trusts the workspace dirty flag and has no explicit editor flush. Loss in that window depends on focus/event ordering and was not reproduced in the desktop run.

Smallest fix: flush editor state before close, then drain that document's revisions before forgetting it. `saveAll()` already rescans dirty buffers; the single-document close path needs an equivalent guarantee.

### Medium: draft recovery ignores the baseline it stores

[`PageDraft.baseSourceHash`](src/app/pageDrafts.ts#L35) is written but never consulted by the recovery logic in [`useWorkspaceDocuments.ts:77`](src/features/workspace/useWorkspaceDocuments.ts#L77). Recovery compares the old draft against today's disk content, uses today's hashes, and marks differences as local edits. After the generic "Recover draft" confirmation, autosave can overwrite intervening external changes without explaining that consequence.

Smallest fix: compare the stored baseline before recovery. A mismatch should remain a conflict requiring an explicit replacement decision. The current patch does this and changes the prompt to an explicit "Replace with draft" action when the baseline does not match.

## Failure handling and operability

### Medium: one corrupt draft can break recovery listing for every project

[`drafts.rs:81`](src-tauri/src/drafts.rs#L81) parses each record with `?` before filtering by project. One malformed JSON file aborts the entire list, including requests for an unrelated healthy project. [`useFractalSession.ts:90`](src/app/useFractalSession.ts#L90) then converts listing failure into a draft count of zero. Broken recovery storage can look empty.

Draft deletion is also frequently fire-and-forget, including [successful saves](src/features/workspace/documents/documentPersistence.ts#L185). Failed cleanup is neither awaited nor reported there, leaving stale recovery prompts. Draft errors from Tauri are plain objects, but several frontend paths stringify them into `[object Object]`.

Smallest fix: report per-record listing failures alongside healthy drafts; preserve an unknown/error count; handle cleanup failures and normalize structured errors.

## UI performance and frontend/backend blocking

### High: filesystem work still runs in synchronous Tauri commands

Page read/write/search and draft commands use blocking workers. However, [project open](src-tauri/src/fractal_adapter.rs#L527), [inspection](src-tauri/src/fractal_adapter.rs#L241), catalog loading, creation, moves, deletion, repair, validation, and [exports](src-tauri/src/fractal_adapter.rs#L719) remain synchronous commands. The installed Tauri macro executes these through its blocking command path. Frontend `await` does not move their work off the native event thread.

Fractal project operations scan files and acquire filesystem locks. A large project, slow storage, or another process holding a lock can stall native event handling. The smoke run did not measure such a stall.

Smallest fix: use the existing `spawn_blocking` pattern consistently for filesystem commands. Keep write ordering explicit when moving more work onto workers.

### High at scale: page operations repeatedly scan the entire project

[`fractal_read_page`](src-tauri/src/fractal_adapter.rs#L547), search, and [three-second polling](src-tauri/src/fractal_adapter.rs#L681) each open a fresh Fractal project. Inspection of the locked `9f947c7` dependency confirms that opening reads, parses, and hashes all native pages. Mutations also reload under the lock and after commit. [Mutation snapshots](src-tauri/src/fractal_adapter.rs#L308) send every page's text and links back over IPC.

Opening one page therefore scales with the whole library. Polling one open tab repeatedly pays that cost while idle. Saving several sections repeats it again. Moving work to a worker avoids one kind of freeze but does not remove this I/O, CPU, allocation, or IPC cost.

Smallest fix: first coalesce project work and reduce snapshot payloads. Then provide a Fractal-supported way to reuse or refresh project state. Keep Fractal as the write authority; do not build a competing persistent index.

### High at scale: derived links perform expensive work inside editor transforms

[`pageLinks.ts:44`](src/features/editor/components/pageLinks.ts#L44) tests every title at every character position, repeatedly slicing and lowercasing strings. A local Node probe of the actual function, with an 8,100-character text node and no matches, took roughly 136 ms for 100 titles and 1,320 ms for 1,000 titles. These are single-run algorithm measurements, not WebKit frame timings.

[`InlinePageLinksPlugin.tsx:93`](src/features/editor/components/InlinePageLinksPlugin.tsx#L93) marks every text node dirty when the pages array changes. Each save supplies a new array. [`EditorGroupPane.tsx:100`](src/features/workspace/components/EditorGroupPane.tsx#L100) keeps hidden tabs and their editors mounted, multiplying retained DOM, history, and transform work.

Smallest fix: key link targets by title/path changes, precompute normalized titles, and replace the character-by-title scan with a multi-pattern matcher. Suspend unnecessary work in hidden editors while preserving undo state.

### Medium: the HTML bridge repeatedly processes whole documents

Every exported edit serializes the Lexical document, parses it for cleanup, reparses the native source to replace its body, and reparses that source for counts, outline, and compatibility. See [HtmlBridgePlugin](src/features/editor/components/HtmlBridgePlugin.tsx#L30), [pageSource](src/features/editor/components/pageSource.ts#L36), and [FractalEditor](src/features/editor/components/FractalEditor.tsx#L80). Debouncing delays this synchronous work; it does not divide it.

The [batched importer](src/features/editor/components/editorHtml.ts#L77) also parses the whole HTML first and batches by top-level node. One enormous table is still one enormous batch.

Smallest fix: derive counts and outline from editor state, defer nonessential analysis, and bound import work inside large containers. Measure large tables and long paragraphs, not just many small paragraphs.

## Structure, dead code, and stale material

Low severity. The dependency list is mostly defensible for the shipped features. I did not establish widespread dead production code or an abandoned subsystem worth ripping out.

- The unused importer helper in [`editorHtml.ts`](src/features/editor/components/editorHtml.ts) was removed in the current patch.
- [`docs/architecture.md`](docs/architecture.md) describes raw HTML editing, iframe/media preservation, browser-local drafts, and manual folder creation that no longer match this native-only implementation. It also promises save-queue draining that single-document saves did not provide. Rewrite it against current behavior.
- The stale `Amanite/0.2` AI user-agent was replaced with the Cargo package version in the current patch.
- Workspace orchestration is 616 lines, with project state held in both session and workspace layers plus refs and document copies. The partial-save bugs show why ownership matters here. Clarify snapshot and receipt ownership before adding another coordination hook.

The production build contains a 591.23 kB workspace JS chunk and 112.45 kB of CSS before gzip. Vite warns about chunk size. Those numbers merit profiling, but the confirmed repeated work above is a better first target than cosmetic bundle splitting.

## Security and trust boundaries

The native-only write boundary, section hashes, Fractal locks and transactions, restrictive production CSP, URL checks, and session-only AI key are good choices. No confirmed security exploit emerged from this review. The markup allowlist issue above is a preservation failure despite those protections.

## Tests and verification

The baseline passed 77 frontend tests across 23 files, 17 Rust tests, TypeScript/Vite build, Rust formatting, and Clippy with all targets/features and warnings denied. The prescribed WebDriver doctor and real Tauri desktop smoke run also passed. Desktop artifacts are in `artifacts/tauri-webdriver/2026-09-06T17-47-03-712Z/`.

The current fix set adds regression coverage for markup protection, section-hash conflicts, partial rename failure, revision draining, and editor flush coordination. It passes 81 frontend tests across 24 files, 17 Rust tests, the TypeScript/Vite build, Rust formatting, Clippy, and the real Tauri desktop smoke flow. The latest desktop artifacts are in `artifacts/tauri-webdriver/2026-09-06T18-42-08-301Z/`.

The suite covers useful happy paths, but several tests inspect source strings or isolated helpers rather than exercising the advertised behavior. Desktop smoke is absent from CI. There are no demonstrated large-project latency budgets or tests here for close-during-save, multi-section partial failure, and recovery over an externally changed baseline. Those are the next tests that would earn trust. Another assertion that a command name exists would not.
