# Document data-flow revisit plan

Status: in progress. R0 through R6 implementation and the R7 local Linux pass
are complete. Cross-platform, latency-distribution, and recovery fault-matrix
acceptance remain open.

This plan follows the review of D0 through D8, commits `8fd3318` through
`8c31cd1`. It closes gaps in the [original plan](document-dataflow-plan.md)
without discarding the session, query, recovery, and reconciliation work already
landed. The implementation baseline is `8c31cd1`.

The original plan's completion claim is not sufficient evidence of acceptance.
Keep implementation status separate from verified behavior and measured results.
Historical D0–D8 reports remain records of what was tested at the time.

## Requirements

- Keep Tauri, React, Lexical, both editor groups, and folder editing.
- Keep all durable project writes and exports behind `fractal::Project`, with
  expected section hashes, receipts, and explicit conflict decisions.
- Preserve protected source, untouched sections, native recovery drafts,
  supported formatting, selection, composition, spellcheck, and undo.
- Do not replace duplicate rich views with plain text or independent editors
  synchronized through complete HTML.
- Keep warm editor state. Memory eviction is outside this revisit.
- Do not call missing measurements a known editor limitation. Measure the
  behavior before assigning the cause or accepting an exception.

## Findings and required evidence

| Finding at the baseline | Treatment |
| --- | --- |
| Non-owning views render plain text after model initialization | Confirmed implementation gap; restore rich presentation and interaction parity. |
| HistoryPlugin is mounted in the editing view | History lifetime risk; reproduce cross-view and activation behavior before fixing ownership. |
| Both the bridge and mirror listener compute the full model | Confirmed repeated work; consolidate and bound derived queries. |
| Project and mutation responses retain full snapshots and saved text | Confirmed contract gap; introduce compact publication. |
| Two-second recovery timers exist without confirmed-lag measurements | Scheduling exists; recovery acceptance remains unverified. |
| Snapshot and close contracts lack complete acceptance evidence | Audit identity, composition, timeout, and revision behavior with controlled races. |
| JSDOM fixture timings omit actual editor interaction | Keep them as microbenchmarks; add desktop measurements. |
| Windows and separate Wayland/X11 runs are missing | Platform acceptance remains open. |

## Work order

| ID | Work package | Depends on | Initial status |
| --- | --- | --- | --- |
| R0 | Establish acceptance evidence and desktop instrumentation | None | Complete |
| R1 | Preserve rich views, history, and attachment state | R0 | Complete |
| R2 | Complete revision, snapshot, and close contracts | R1 | Complete |
| R3 | Bound live queries and remove duplicate scans | R1, R2 | Complete |
| R4 | Verify recovery completion and durability | R2 | Implementation complete; platform evidence open |
| R5 | Publish compact catalog and document updates | R0 | Complete |
| R6 | Verify backend ordering and mutation reconciliation | R2, R5 | Complete |
| R7 | Close desktop parity, performance, and documentation gates | R0–R6 | Local Linux checks complete; platform and performance evidence open |

R0 captures the unchanged baseline before optimizations. R1 is a gate for
further editor migration. R5 can proceed independently of editor ownership work.
Keep changes reviewable and run the relevant checks after each package.

## R0. Establish evidence before changing behavior

Use the original deterministic fixture matrix: 100k, 1m, and 5m visible
characters; short paragraphs, a huge paragraph, lists, tables, headings, and
explicit and derived links. Include invalid and protected documents, the
many-page project, dirty pages, duplicate views, and folder editing.

Add instrumentation for:

- Page reads, parse, Lexical import, first editable paint, and warm activation.
- Input-to-paint latency, post-pause stalls, full exports, native reconstruction,
  full-model scans, changed-block scans, and unrelated editor updates.
- Snapshot requests and reuse, draft request/start/confirmation, and save
  request/start/receipt, each associated with document identity and revision.
- Fractal opens/reloads, lock wait, operation time, refresh requests, catalog
  rebuilds, title-index invalidations, and actual serialized IPC bytes.
- Process memory, including webview child processes, as supporting evidence.

Run interaction checks through the real Tauri WebDriver harness. Begin with
`pnpm run tauri:webdriver:doctor` and `pnpm run tauri:webdriver:smoke`.
Build through the Tauri CLI so frontend assets are included. Keep the WebDriver
feature debug/test-only. Use a comparable release-like build with a separate
measurement path for performance; record any instrumentation overhead.

Record machine, OS, display backend, webview, build profile, commit, fixture
hashes, sample counts, raw timings, median, p95, and maximum stall. Use at least
20 samples for ordinary interactions. Declare the large-fixture sample policy
before running; report insufficient samples instead of presenting a single
observation as meaningful tail latency. Preserve timeouts and failures.

Retain the original targets:

| Measure | Target |
| --- | ---: |
| Cold first editable paint | <= 1,500 ms |
| Warm activation | <= 50 ms |
| Typing foreground stall p95 | <= 50 ms |
| Longest post-pause stall | <= 100 ms |
| Confirmed recovery checkpoint lag during continuous editing | <= 2,000 ms |
| Complete HTML exports caused by ordinary content transactions | 0 |

Distinguish exports requested by recovery or save from exports caused directly
by a content transaction. Include their foreground cost in the latency results.
Publish results per fixture, not just a combined average. A failed target stays
open unless the user explicitly accepts a measured exception.

Exit: a reproducible desktop baseline and a checklist linking every remaining
acceptance criterion to a test, measurement, or explicitly unverified item.

Implementation status: complete. The event recorder and desktop export are
described in [R0 baseline evidence](measurements/document-dataflow-r0.md).

## R1. Restore shared-view parity and stable lifetime

First add reproductions for group-to-group focus changes, warm tab switching,
tab/folder attachment changes, and title-derived rename. Check whether history
survives each transition; do not assume sharing a LexicalEditor shares the
mounted HistoryPlugin's lifetime.

- Make the document session own history explicitly, using Lexical's supported
  history state mechanism. View mounting must not create a new undo history.
- Retain selection and scroll per unique view ID, including group and folder
  context. Define selection restoration after transactions in another view.
- Restore faithful rich rendering in every visible view, including formatting,
  tables, lists, and links. Remove the plain-text mirror fallback.
- Prototype focus transfer with one transaction authority. Clicking into either
  group or folder view must allow normal editing and toolbar use. Transfer must
  settle composition and preserve the intended caret position.
- Keep editor controllers alive independently of an individual view. Track
  attachment references and pending save/recovery obligations before disposal.
- Avoid complete HTML export/import as the mechanism for view synchronization.

Do not mandate a rendering mechanism before the prototype proves it. If the
current Lexical integration cannot preserve these behaviors with one active
input owner, record the exact blocker and proposed alternatives for a product
decision. Do not proceed by silently reducing editable-view behavior.

Exit: deterministic ownership/history tests plus desktop checks for cross-view
undo/redo, independent selections and scroll, formatting, table editing, links,
composition, toolbar actions, and conflicting pending input. Warm activation
and rename produce no disk read, source import, or history reset.

Implementation status: complete. Each view now has a session-owned Lexical
controller, while the session shares editor states directly and owns one
external history state. Only the current input owner registers history. Rich
inactive views no longer fall back to plain text. See
[R1 verification](measurements/document-dataflow-r1.md).

## R2. Complete snapshot and operation barriers

- Use one monotonic document revision for body and title transactions. Undo and
  redo advance it. Selection and derived decoration do not. Source replacement
  must have explicit incarnation semantics rather than ambiguously resetting it.
- Associate snapshot requests and replies with project generation, document
  identity/incarnation, request ID, and the exact captured revision.
- Capture title and body consistently with the accepted untouched sections.
  Reuse completed snapshots and coalesce compatible in-flight requests.
- Reject obsolete publication at every asynchronous boundary: loads, queries,
  refreshes, save receipts, draft completion, and recovery prompts. Reconcile a
  committed stale write with its original operation; dropping its UI reply does
  not undo disk changes.
- Make save persist a captured revision while later edits remain pending.
  Close must settle composition, establish a bounded final-edit barrier, await
  required writes, and release the session only after success.
- Give missing controllers, timeouts, composition failures, and failed writes
  explicit outcomes. Keep the document available; never silently discard it or
  chase new revisions indefinitely.
- Audit focusout and unmount exports. Replace incidental serialization with
  explicit consumer requests where it is not needed for correctness.

Exit: tests for immediate type-and-close, save-all before serialization, actual
composition-at-close, save N while editing N+1, title/body races, partial section
success, same-root reopen, replaced document replies, and failed close. Preserve
original expected hashes for unsent sections after partial success.

Implementation status: complete. Snapshot requests now select one current view
controller, coalesce compatible work, and validate document, request, and
revision identity. Source replacement advances an incarnation without resetting
the revision counter. See [R2 verification](measurements/document-dataflow-r2.md).

## R3. Bound derived work during editing

- Give the session one derived-model service. Remove the separate full-model
  computations in the bridge and shared mirror listener.
- Use Lexical dirty-node information to update cached block text, counts, and
  headings. Invalidate affected ancestors for lists and tables. Cover deletion,
  reordering, undo, and source replacement explicitly.
- Compose full text lazily when a consumer needs it. Cache by revision and
  reuse the result across folder search, Quick Open, Borealis, and find.
- Slice bounded reads from cached text or block ranges. Do not repeatedly parse
  native source or rebuild a full string for each range request.
- Where incremental maintenance is impractical, use measured, coalesced work
  with explicit freshness. Do not replace a synchronous scan with an equally
  large synchronous timeout callback and claim the stall is fixed.
- Stop hidden views from recomputing unused presentation. Keep visible rich
  views correct through the R1 design without duplicate document-wide scans.

Exit: editing one short block in a large document does not traverse every block
for ordinary counts or mirror updates. Tests verify counts, nested structures,
outline, find, Unicode, and unsaved search semantics. Measurements show the
remaining full computations and their foreground cost. No stale result replaces
a newer revision, and a body-only save leaves the title index unchanged.

Implementation status: complete. One derived-model service now belongs to each
document session. It updates cached blocks from Lexical dirty-node sets and
builds full text lazily. See
[R3 verification](measurements/document-dataflow-r3.md).

## R4. Prove confirmed recovery behavior

- Measure lag to successful native draft completion, not just timer firing.
  Keep requested, captured, queued, and confirmed revisions distinct.
- Carry the earliest outstanding checkpoint deadline through scheduling and
  in-flight work. Exercise continuous typing, slow export, slow storage, and
  competing saves across several documents.
- When completion exceeds the target, expose the lag or failure per document.
  Another document's success must not clear that state. Provide a bounded retry
  policy for transient failure, including an unchanged dirty revision.
- Verify snapshot reuse between recovery and autosave and ordering of draft
  write, move, cleanup, and deletion across rename and project replacement.
- Preserve legacy native draft reading and base hashes. Restore the latest
  confirmed revision and explain intervening external changes.
- Add controlled process termination around temporary write, file sync, rename,
  directory sync, and cleanup. Test replacement behavior on Windows and Linux.
  State process-crash guarantees separately from power-loss guarantees.

Exit: continuous-edit checkpoint measurements, queue race tests, per-document
error tests, and a termination matrix. A two-second start deadline alone does
not pass the two-second confirmed checkpoint criterion.

Implementation status: complete. Scheduling retains the first outstanding
deadline, records requested, captured, queued, and confirmed revisions, and
retries unchanged dirty revisions after transient failures. See
[R4 verification](measurements/document-dataflow-r4.md). Windows replacement
and power-loss evidence remains open for R7.

## R5. Finish catalog separation and compact IPC

- Define a metadata-only catalog contract with stable document/path/title
  entries and catalog versions. Remove full source and saved page text from
  generic catalog and ordinary mutation responses.
- Fetch document content explicitly. Provide saved search and bounded text
  queries with a documented freshness contract, overlaying live sessions so
  folder search, Quick Open, and Borealis agree about unsaved content.
- Return mutation receipts with affected catalog entries, removals, path maps,
  and required affected-document data. Do not transfer unrelated document text.
- Keep an explicit full resynchronization path for startup and uncertain
  outcomes. Validate delta base versions and request resynchronization on gaps.
- Preserve unchanged frontend references and the shared title/path index.
  Explorer and tab chrome subscribe to metadata and status, not complete source.
- Migrate consumers and remove transitional full-snapshot adapters before exit.

Exit: contract tests show an ordinary page read contains only requested content,
and a body-only mutation response does not grow with unrelated project text.
Record actual before/after IPC bytes on the many-page fixture. Query tests cover
saved fallback, live overlays, renamed paths, and stale-result rejection.

Implementation status: complete. Catalog pages now contain path, title, and
content hash only. Document reads and bounded saved searches are explicit;
live query entries override saved results. Mutation publications carry a base
catalog version and only affected page/folder entries, and the client requests
a full catalog resynchronization when versions do not join. See
[R5 verification](measurements/document-dataflow-r5.md).

## R6. Verify ordered backend work and receipt reconciliation

- Audit ordering across cached reads, explicit opens, refreshes, and mutations.
  In particular, prevent a project loaded before acquiring the session lock
  from replacing newer state after a mutation. Add a controlled race test.
- Serialize conflicting operations per project, bound background concurrency,
  and coalesce redundant refreshes. Avoid blocking unrelated projects behind
  unnecessary global work.
- Define frontend/backend session generation mapping, catalog versions, and
  invalidation after partial, committed-error, or indeterminate outcomes.
- Verify external edits, deletions, renames, missed notifications, and resume.
  Refresh clean sessions deliberately; retain dirty and missing sessions.
- Apply each receipt through the existing central reconciliation path exactly
  once, including link-rewritten pages, tabs, histories, folder references,
  drafts, queued work, and query entries.
- Retain conservative save barriers where rewrite scope is unknown. Verify
  scoped exports resolve paths after saves and use the intended saved checkpoint.

Exit: deterministic refresh/mutation race tests and receipt tests for partial
success, uncertain outcomes, external deletion, and link rewrites. Warm cached
reads do not reopen Fractal without a freshness reason. Report Amanite savings
separately from reloads still required inside Fractal; no direct-write shortcut.

Implementation status: complete. Project operations use per-project locks;
refresh loads occur after taking that lock, unchanged refreshes retain their
catalog version, and unrelated cached projects proceed independently. Backend
session generation remains stable across refreshes and is separate from the
frontend editor generation. Compact publications validate their base version
and use a full catalog refresh on a gap. See
[R6 verification](measurements/document-dataflow-r6.md).

## R7. Acceptance and documentation

Run frontend tests, type checking, frontend build, Rust tests, and the real
desktop doctor/smoke flow. Use a valid full Tauri WebDriver build before any
`--skip-build` rerun. Keep artifacts and exact reproduction commands.

Run the parity and recovery matrix on Windows and Linux, with Wayland and X11
recorded separately. Exercise real OS IME composition on those targets;
synthetic composition events remain useful contract tests but do not replace
IME evidence. Exercise macOS where hardware is available. Missing hardware is
an unverified item, not a passing result.

Repeat R0 measurements on the same machine, build profile, and unchanged
fixtures. Publish every fixture, including large-document failures, with sample
counts and before/after distributions. Explain measured regressions and name
the remaining Fractal or Lexical costs only where traces support attribution.

Update `architecture.md` to the final implementation. Update the original
plan's status to distinguish completed implementation from outstanding
acceptance, and link this revisit and its evidence. Preserve historical reports
rather than rewriting their results. Remove obsolete adapters and claims.

Implementation status: the local Linux implementation, repository checks, and
fresh-build Tauri desktop smoke pass are complete. The smoke run exposed and
then verified fixes for reused snapshot request IDs, snapshots requested during
controller mount, and recovered shared-session revisions. A confirmed draft
request initially retained stale timing state; the follow-up run confirmed
all seven checkpoints in 189 to 482 ms without a duplicate write. The required
latency distributions and platform matrix have not been collected. See
[R7 local acceptance evidence](measurements/document-dataflow-r7.md).

### Completion checklist

- [x] Rich multi-view behavior and session-owned history pass R1.
- [x] Revision, snapshot, stale-result, and close contracts pass R2.
- [x] Derived work is bounded and query semantics pass R3.
- [ ] Confirmed recovery and termination behavior pass R4.
- [x] Compact catalog/content contracts and IPC measurements pass R5.
- [x] Backend ordering and receipt reconciliation pass R6.
- [ ] Required platform parity checks have recorded evidence.
- [ ] Performance and recovery targets pass, or specific measured exceptions
      have explicit user acceptance and remain visible in the report.
- [x] Repository checks pass and documentation describes the shipped behavior.

Completion requires evidence for these items. A passing smoke test or a list of
remaining limits cannot substitute for an unmet acceptance criterion.
