# Amanite document data-flow plan

Status: D0 through D2 complete. D3 is in progress.

This plan improves loading, editing, tab activation, recovery, and persistence
within the existing Tauri, React, Lexical, and Fractal stack. GPUI work is paused.
The priority is reliable editing with fast document access and predictable work.
Reducing resident memory is secondary to preserving warm tab switching and undo.

The plan adopts the document-session and snapshot ideas from the
[GPUI hybrid experiment](gpui-hybrid-experiment-plan.md) without adopting its
shell migration. The [native v2 plan](amanite-native-v2-plan.md) defines the
existing product boundary. This document defines a target architecture, not a
description of already completed changes.

## Scope and fixed requirements

- Keep Tauri, React, and Lexical. Do not build a native editor or add webviews.
- Edit native `*.fractal.html` documents only.
- Route every durable project mutation through `fractal::Project`, including
  section writes, rename, move, deletion, recreation, repair, and export.
- Preserve expected section hashes, transaction outcomes, mutation receipts,
  warnings, and explicit conflict decisions.
- Preserve existing supported formatting and word-processor behavior, including
  tables, lists, links, undo, selection, composition, and spellcheck.
- Keep invalid or incompatible documents protected with exact-source display.
  Do not silently sanitize unsupported content into an editable replacement.
- Preserve untouched style and metadata sections. Recovery drafts remain native
  source in app data, outside the project, and never become another page format.
- Keep both editor groups and folder editing. Any proposed reduction in editable
  views requires a separate product decision; it is not an implementation shortcut.
- Prioritize Windows and Linux, with Wayland and X11 exercised separately. Keep
  existing macOS behavior where test hardware is available.
- Make no performance claims without measurements. Structural improvements may
  proceed on evidence of repeated work, with before/after measurements attached.

## Evidence and limits of the review

The review traced Amanite source and Fractal revision `9f947c7`. It did not
benchmark the app or reproduce the suspected timing failures. Confirm behavior
against the implementation commit before starting each work package.

| Observed behavior | Consequence to investigate | Source |
| --- | --- | --- |
| Full body HTML exports after a 120 ms editing pause and on flush | Document-sized work returns during ordinary typing pauses | [HtmlBridgePlugin](../src/features/editor/components/HtmlBridgePlugin.tsx) |
| Export cleanup, native-source reconstruction, and source analysis each process HTML | Repeated conversions connect editing to counts, outline, and compatibility checks | [editorHtml](../src/features/editor/components/editorHtml.ts), [pageSource](../src/features/editor/components/pageSource.ts), [FractalEditor](../src/features/editor/components/FractalEditor.tsx) |
| Full HTML is parsed before one top-level node is imported per scheduled batch | Many small blocks incur many batches; a huge block can exceed the character budget | [editorHtml](../src/features/editor/components/editorHtml.ts) |
| All tab panels stay mounted; separate views create separate composers | Warm tabs retain useful state, but shared source does not establish shared editing transactions | [EditorGroupPane](../src/features/workspace/components/EditorGroupPane.tsx), [RichDocumentEditor](../src/features/editor/components/RichDocumentEditor.tsx) |
| Composer and tab identity use page paths | Rename can reconstruct editor state | [RichDocumentEditor](../src/features/editor/components/RichDocumentEditor.tsx), [Workspace](../src/features/workspace/components/Workspace.tsx) |
| Dirty status follows exported source; save-all enumerates already-dirty buffers | Pending editor edits may be missed by close or save-all; requires reproduction | [documentPersistence](../src/features/workspace/documents/documentPersistence.ts), [App](../src/app/App.tsx) |
| Draft scheduling observes all buffers and lacks drafted revisions | Unchanged dirty pages can be scheduled again; continuous edits can postpone recovery | [useDocumentDrafts](../src/features/workspace/documents/useDocumentDrafts.ts) |
| New project page arrays invalidate derived-link targets and mark all text nodes dirty | An unrelated save can trigger work in mounted editors | [InlinePageLinksPlugin](../src/features/editor/components/InlinePageLinksPlugin.tsx) |
| Page reads, searches, polling, and section writes open fresh Fractal projects | These operations can scale with total project content | [fractal_adapter](../src-tauri/src/fractal_adapter.rs) |
| Mutation responses include all page text and active-document content | Small writes transfer broad snapshots and invalidate frontend consumers | [fractal_adapter](../src-tauri/src/fractal_adapter.rs) |
| Ordinary document saves flatten most non-conflict errors into messages | Committed or uncertain outcomes lack the treatment used by project commands | [documentPersistence](../src/features/workspace/documents/documentPersistence.ts), [fractalFailure](../src/app/fractalFailure.ts) |
| Folder search uses saved catalog text; Borealis reads buffers and parses before slicing | Freshness varies by feature; bounded output does not mean bounded computation | [FolderView](../src/features/workspace/components/FolderView.tsx), [workspaceTools](../src/lib/ai/workspaceTools.ts) |

Fractal's pinned `src/project/lifecycle.rs` opens a catalog through `reload`.
`src/project/storage.rs` reads, parses, and hashes all native documents during
reload. Section mutation paths also reload for correctness and after commit.
Retaining a project handle alone will not remove those internal reloads.

The existing [architecture document](architecture.md) contains historical claims
about raw pages and browser-local drafts that no longer match the native-only
implementation. Update it during this work; do not treat those claims as scope.

## Target ownership

```text
React tabs, explorer, status, and document views
    |
    +-> workspace navigation state: view IDs, document IDs, focus, history
    |
    +-> TypeScript document sessions
            |
            +-> Lexical live model and explicit undo ownership
            +-> immediate revision notifications
            +-> revision-tagged counts, outline, and text queries
            +-> coalesced snapshot requests
                        |
                        v
                Rust project service
                    +-> ordered Fractal operations and refreshes
                    +-> receipts and affected catalog/document updates
                    +-> native-source recovery storage
                        |
                        v
                  fractal::Project
                        |
                        v
                  native project files
```

Initially keep the live document coordinator in TypeScript, close to Lexical.
React subscribes to it but does not own its queues or lifetime. Rust owns Fractal
execution, project cache freshness, and recovery storage. Do not send every
keystroke across IPC just to duplicate session state in Rust.

The frontend session chooses which revision needs saving or drafting. Rust
executes each requested operation and returns its outcome. Avoid two independent
autosave schedulers or two competing definitions of dirty state.

### Document session

Each open page has one logical session containing:

| Field or concept | Meaning |
| --- | --- |
| Project session generation | Changes on every open, including reopening the same root |
| Document ID | Stable in-memory identity across rename and move |
| Current path | Mutable project-relative location, indexed separately |
| Accepted base source and parts | Last accepted Fractal source, section values, and hashes |
| Current revision | Latest committed editable transaction, including title edits |
| Latest snapshot | Serialized editable sections tagged with the exact captured revision |
| Saved revision and section acknowledgements | Confirmed persistence, including partial section success |
| Drafted revision | Latest revision confirmed by recovery storage |
| Conflict and operation state | Explicit loading, saving, uncertain, missing, or protected states |
| Attached views | View IDs with selection, scroll, and focus state |
| Editor model and history ownership | Defined by the multiple-view design, never inferred from HTML equality |

Selection-only changes and derived-link decoration changes must not mark durable
content dirty. Undo and redo are new editable revisions even when they restore
earlier content. Revisions do not go backwards or reset on rename.

A save of revision N never marks N+1 clean. Partial section success must not
advance the whole-document saved revision as if every section succeeded. Keep
original expected hashes for unsent sections; a preceding title save must not
adopt a newer external content hash and silently authorize an overwrite.

### Snapshot contract

- Report editable revisions immediately without generating HTML.
- Request snapshots explicitly for draft, save, export preparation, close, or
  another consumer that actually needs serialized content.
- Reuse a snapshot when its revision satisfies the request. Coalesce concurrent
  requests and keep obsolete work bounded.
- Capture the exact revision that was serialized. A request for at least N may
  return N+1; it must never label newer content as N or return older content as current.
- Tag replies with project generation, document ID, request ID, and revision.
  Reject replies from replaced sessions or document incarnations.
- Treat full HTML export as potentially blocking editor work. Moving the
  reconstruction of native source into Rust does not make Lexical export free.
- Keep accepted native source unchanged until a receipt or explicit reload
  establishes a new base. Reconstruct recovery source from a captured snapshot
  and the appropriate untouched sections outside routine rendering.

### Multiple views and residency

Prove the live-model and undo design before completing snapshot migration.
Separate editable models exchanging periodic HTML are not an acceptable final
design. Candidate implementations may share transactions between views or use
one authoritative editor with explicit view attachment, but must preserve the
existing editing behavior or stop for a product decision.

Test distinct selection and scroll positions, cross-view undo, composition,
toolbar actions, and conflicting pending edits. Define how focus changes transfer
editing ownership if the implementation uses one active editable view at a time.

Keep warm sessions generously at first. Tab activation must not imply saving,
disk reads, HTML import, or history reconstruction. Track folder and tab references
so closing one view cannot dispose a document still used elsewhere.

Eviction is optional later work. Any policy must preserve dirty content and make
undo/history behavior explicit. Bound live DOM work before minimizing memory.

## Work packages

| ID | Work package | Dependencies | Status |
| --- | --- | --- | --- |
| D0 | Establish fixtures, measurements, and integrity reproductions | None | Complete |
| D1 | Introduce session identity and reliable operation boundaries | D0 | Complete |
| D2 | Prove shared document views and stable editor lifetime | D1 | Complete |
| D3 | Replace source feedback with revisions and snapshots | D2 | In progress |
| D4 | Schedule recovery and autosave per revision | D3 | Not started |
| D5 | Separate catalog, navigation, and derived queries | D3 | Not started |
| D6 | Retain Rust project state with explicit freshness | D1, D5 contracts | Not started |
| D7 | Centralize receipt reconciliation and mutation scope | D4, D5, D6 | Not started |
| D8 | Complete parity, performance, and documentation review | D1 through D7 | Not started |

Use small reviewable changes. Keep the app runnable at each stage. Transitional
adapters may feed old consumers, but name them and remove them before D8. Do not
maintain two independent persistence systems during migration.

### D0. Establish evidence

Create deterministic native fixtures with supported formatting, invalid source,
and Fractal-valid content that Amanite cannot safely edit. Include roughly
100,000, 1,000,000, and 5,000,000 visible characters, varying document structure:
many short paragraphs, one huge paragraph, nested lists, large tables, headings,
and dense explicit and derived links.

Include a many-page project, several dirty documents, warm and cold tabs, the
same page in both groups, and folder editing. Record the largest fixture's honest
result even if it exceeds acceptable interaction limits.

Measure page read, HTML parse/import, first editable paint, warm activation,
typing and post-pause stalls, export, source reconstruction, draft confirmation,
Fractal operation time, IPC payload size, and unrelated editor updates. Record
process memory as supporting evidence, including child processes where present.

Count whole-document exports, imports, catalog rebuilds, and title-index
invalidations. Record build, machine, OS, webview version, document structure,
median, slow-tail latency, and longest foreground stall. Use comparable
release-like builds for timing; retain the debug harness for interaction tests.

Reproduce or disprove immediate close after typing, save-all with pending editor
content, stale replies after reopening a project, and simultaneous view edits.
Keep unresolved risks labelled as such.

Exit criteria:

- Baseline and exact interaction sequences are recorded.
- Numeric latency budgets and a recovery-lag target are selected on project
  hardware before accepting performance changes.
- Reliability reproductions become regression tests where practical.

### D1. Establish reliable sessions and operation boundaries

- Introduce stable document IDs, project generations, and path lookup.
- Report pending editable changes immediately, initially allowing the existing
  serializer as a temporary adapter.
- Replace correctness-critical global flush events with an explicit registered
  editor contract whose completion can be awaited.
- Make close-all and save-all discover live editor changes before consulting
  serialized buffer state. React render/effect timing cannot be the authority.
- Define ordinary save as persisting a captured revision while editing continues.
- Define close as a scoped barrier that settles composition, captures final
  revisions, confirms required writes, and only then releases sessions.
- On timeout or failure, keep the window/session available with a clear outcome.
  Do not silently discard edits or loop indefinitely chasing new revisions.
- Unify typed mutation outcomes across document and project actions. Preserve
  conflict, partial success, `mutation_committed`, `indeterminate`, and
  `recovery_required`; inspect/reconcile before retrying uncertain outcomes.
- Check generation and document identity before publishing every async result,
  including loads, polling, save receipts, recovery prompts, and derived work.
  An obsolete committed disk write still needs reconciliation for its original
  session; ignoring a UI reply does not cancel a completed mutation.

Exit criteria:

- Immediate type-and-close, save-all before export, and composition-at-close
  preserve all confirmed editable content.
- Saving N while editing N+1 leaves N+1 pending.
- Reopening the same root cannot accept an old session's result.
- Existing partial-save and expected-hash tests remain valid.

### D2. Prove model ownership and lifetime

- Implement and test the selected shared-view design with one logical history
  policy and transaction authority per document.
- Key document lifetime by ID, not current filesystem path.
- Preserve model, undo, selection, and scroll during ordinary tab activation and
  title-derived rename. Retarget links and paths through explicit updates.
- Count all view references, including folder editors. Dispose only after the
  session's save/recovery obligations are satisfied and references are released.
- Keep inactive views from performing avoidable derived work while retaining
  enough state for immediate warm activation.

Exit criteria:

- Edits and undo in either group follow the documented shared-session policy.
- Folder and tab views cannot overwrite each other's pending edits.
- Warm tab switching and rename do not reimport the document or reset history.
- If the design cannot preserve required multi-view behavior, record the blocker
  before proceeding. Do not quietly fall back to complete-HTML synchronization.

### D3. Remove complete source from routine editing

- Replace the 120 ms full-HTML feedback loop with revision notifications.
- Add the snapshot contract and separate accepted source from current model.
- Move counts, outline, and find toward live model queries with revision tags.
  Update changed blocks where practical; expensive scans run on demand or on a
  bounded schedule, never implicitly because a component rerendered.
- Inspect compatibility at import/replacement boundaries. Preserve protection
  for unsupported input and validate all serialized output through Fractal.
- Improve import batching using a time budget and document structure. Measure
  the initial parse separately; yielding between blocks does not bound the cost
  of parsing the whole input or importing one enormous table/paragraph.
- Do not enable editing of an incomplete imported document unless partial editing
  has a proven model and persistence contract. A loading preview is not readiness.
- Avoid moving DOM-dependent code to workers as an assumed fix. Off-thread work
  needs data and algorithms that can actually run there.

Exit criteria:

- Ordinary content transactions generate no full HTML exports or source rebuilds.
- Repeated snapshot consumers share work for the same revision.
- Counts, outline, find, title edits, and formatting remain correct.
- Import time and post-pause typing stalls improve or have a documented remaining
  editor limitation, with no hidden loss of supported structure.

### D4. Make recovery and autosave revision-aware

- Schedule per document, recording requested and confirmed draft/save revisions.
- Use both idle scheduling and a maximum recovery-lag policy so continuous typing
  cannot postpone recovery indefinitely. Define behavior when export/write time
  itself exceeds the target; expose lag or failure rather than claiming protection.
- Reuse snapshots between autosave and recovery when their revisions agree.
- Serialize draft write, move, and delete operations for a logical document.
  A stale cleanup must not remove a newer draft; rename must not resurrect an
  old-path draft or lose the new-path record.
- Preserve existing native-source drafts and provide version-aware reading if
  recovery record metadata changes. No new project format is needed.
- Return draft metadata for listing/counting. Read source only for recovery or
  another operation that needs it.
- Audit replacement durability on desktop targets, including forced termination
  between write, sync, rename, and cleanup. State separately what is guaranteed
  for process crashes and for power loss.
- Keep draft errors per document so another document's successful write cannot
  hide an outstanding recovery failure.

Exit criteria:

- An unchanged dirty revision is not repeatedly drafted.
- Continuous editing reaches confirmed recovery checkpoints.
- Write/save/rename/delete orderings preserve the newest required draft.
- Recovery after termination restores the latest confirmed draft and uses its
  base hashes to explain external changes.

### D5. Narrow frontend data and invalidation

- Separate project catalog metadata, document sessions, and workspace navigation.
  Remove active-page source from the generic catalog contract.
- Publish small document and catalog updates with stable identities. Preserve
  references or versions for unchanged title/path entries.
- Build a shared title/path lookup index. Recompute derived-link matches when
  relevant titles, paths, or text change, not on every project snapshot.
- Stop rebuilding the target lookup for each text-node match where it can be
  reused. Preserve Unicode boundaries and existing matching precedence.
- Replace feature-specific source parsing with query methods for text ranges,
  counts, outline, links, and search. Label results by revision and freshness.
- Give folder search, quick open, and Borealis a consistent policy for unsaved
  content. Overlay live sessions on saved project search where required.
- Make bounded text reads avoid repeated whole-source parsing. Cache derived
  text by revision or use block/range queries. Be explicit if an initial full
  computation remains necessary.
- Separate draft/catalog summaries from full content reads.

Exit criteria:

- A body-only save does not rebuild the title index or mark unrelated editor
  text nodes dirty.
- Explorer and tab chrome do not subscribe to complete document strings.
- Query tests prove the selected unsaved-content semantics across features.
- Outdated derived replies cannot replace newer displayed results.

### D6. Retain project state in Rust

- Introduce a session service around `fractal::Project` with explicit generation,
  cancellation/publication rules, and ordered mutations and refreshes.
- Keep blocking Fractal and filesystem work off foreground/runtime threads that
  must serve input. Bound background concurrency and coalesce refresh requests.
- Reuse accepted in-memory project state for reads where its freshness contract
  allows it. Expose an explicit refresh path for fresh disk observations.
- Return changed document data and compact catalog updates after mutations.
  A full resynchronization remains available for startup and uncertain outcomes.
- Version catalog responses so late snapshots cannot replace newer state.
- Treat file notifications as invalidation hints. Retain a reconciliation path
  for missed events, resume, and external changes. Conditional section checks at
  mutation time remain mandatory regardless of cache state.
- Refresh clean sessions deliberately; preserve dirty sessions and compare the
  affected sections before offering conflict choices. Never automatically reload
  over live edits. Distinguish external changes to untouched sections.
- Measure polling separately. A watcher can reduce redundant polls, but cannot
  by itself make Fractal's full reload incremental.

Exit criteria:

- Warm cached reads do not reopen the project without a freshness reason.
- Project operations have defined ordering and stale-response rejection.
- External edits, deletion, rename, sleep/resume, and recovery-required states
  remain detectable without silent overwrites.
- Reports separate Amanite savings from full reloads still required by Fractal.

### D7. Centralize receipts and scope persistence barriers

- Apply each receipt through one reconciliation operation for document paths,
  tabs, history, folder references, catalog entries, drafts, links, and queues.
- Preserve dirty or missing sessions until an explicit resolution permits
  disposal. Absence from a refreshed catalog is not permission to drop content.
- Serialize conflicting project operations and account for pages rewritten by
  title changes or moves. Do not assume the requested page is the only affected one.
- Remove save-all from unrelated UI actions, including opening settings.
- Use scoped save barriers only when affected-document coverage is known.
  Retain conservative barriers for operations whose rewrite scope is uncertain.
- Export from a defined saved revision or checkpoint through Fractal, with
  renamed paths resolved after saving.

Exit criteria:

- Rename/move receipts update all references once without resetting editor state.
- Partial success and external deletion preserve recoverable local content.
- Opening settings or switching tabs does not wait for unrelated writes.
- Link-rewriting mutations and exports retain existing Fractal semantics.

### D8. Verify and document the completed architecture

- Run meaningful frontend unit/integration tests, Rust tests, frontend build,
  and relevant repository checks.
- Use the real Tauri WebDriver harness for desktop behavior. Start with
  `pnpm run tauri:webdriver:doctor` and `pnpm run tauri:webdriver:smoke`.
  Use `--skip-build` only after a valid WebDriver build exists. See
  [desktop harness instructions](tauri-webdriver.md).
- Exercise typing, composition, formatting, tables, undo, both groups, folder
  views, warm switching, rename, external changes, partial saves, export, and
  forced-termination recovery on the desktop targets.
- Re-run D0 measurements with the same fixtures and machine. Explain remaining
  limits rather than changing fixtures to conceal regressions.
- Update `architecture.md` to the implementation that shipped. Remove obsolete
  source adapters, event-flush paths, and historical raw-page claims.

Completion requires preserved product behavior, passing integrity tests, agreed
latency/recovery budgets, and a record of remaining Fractal or Lexical limits.

## Regression contracts

These checks should survive feature additions. Prefer operation counts and
deterministic state tests for CI, with real timing measured on known hardware.

- Typing without a persistence/query request performs no complete HTML export.
- A warm tab activation performs no disk read, HTML import, or history reset.
- A body-only change does not invalidate the project title/path index.
- One requested snapshot satisfies compatible consumers of that revision.
- Save N cannot clear N+1; partial section success cannot imply complete success.
- Close discovers pending editor transactions even before any scheduled export.
- Old project/document results cannot publish into a replacement session.
- Draft cleanup cannot delete a newer required recovery checkpoint.
- Closing one view cannot dispose a session referenced by another view.
- Refresh cannot discard dirty content merely because a file is absent.
- Ordinary page reads and responses do not include unrelated full document text.

## Fractal follow-up, outside the Amanite implementation scope

This is a separate repository workstream. Amanite improvements above should land
without waiting for every item here. Do not bypass Fractal with direct project
file writes or a competing durable index to obtain these gains.

### F1. Measure catalog and mutation work

Instrument open, reload, source/section extraction, search, and section mutation.
Record bytes read, documents parsed, hashes computed, copies made, and time under
locks. Benchmark one changed document in projects of increasing total size.

### F2. Add incremental refresh where safe

Explore refreshing changed documents while retaining unchanged parsed/cataloged
data. Cache section extraction and derived text by accepted source identity.
Define correctness for external edits, missed filesystem events, folder changes,
and links affected by additions, removals, or renames. Timestamps alone must not
replace expected-content validation at write time.

### F3. Avoid redundant mutation reloads

Investigate reducing repeated full catalog reconstruction before and after a
section mutation. Preserve locking, fresh expected-section checks, atomic
transaction behavior, path/link rewrites, and committed/indeterminate reporting.
The optimization may require targeted rereads under the lock and explicit
updates after commit, rather than removing validation.

### F4. Improve read and result APIs

Consider metadata-only catalog access, borrowed/iterated metadata where useful,
cached native parts, bounded text reads, and change-oriented results. These can
reduce cloning all page text when Amanite needs paths, titles, hashes, or a range.
Define snapshot consistency so content, hashes, and metadata describe the same
accepted state.

### F5. Evaluate combined section mutations separately

A guarded multi-section operation could reduce repeated reloads and simplify
partial-save coordination. Treat it as an API and transaction-design proposal,
not an assumption in Amanite's plan. Specify expected hashes, rename effects,
link rewrites, atomicity, receipts, and failure outcomes before adopting it.

For any Fractal change, require integrity tests and benchmark evidence in that
repository, then deliberately update Amanite's pinned revision and rerun its
integration and recovery matrix.

## Deferred decisions

- GPUI and a native rich editor remain paused.
- Aggressive session eviction, rich-document viewport virtualization, and a new
  editor model are not prerequisites. Revisit only after the measured bottleneck
  remains in model/layout work after this plan.
- Moving all TypeScript session logic into Rust is not a goal. Reconsider only
  if it simplifies ownership without creating duplicate live state or extra
  foreground IPC.
- New formats, new formatting features, browser/mobile support, and general
  multi-window editing remain outside this work.
