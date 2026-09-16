# Document runtime replacement plan

Created: 2026-09-16.
Status: design accepted in direction; implementation not started.
Baseline reviewed: `4dc2ba2`. No implementation or performance acceptance is claimed by this document.

## Read this first

This is a replacement of Amanite's document lifecycle, not another optimization
pass over its current buffers, hooks, snapshots, and reconciliation callbacks.
The existing implementation is disposable. Git preserves it. Keep useful UI,
Fractal integration, and editing behavior where they fit the target design;
there is no requirement to preserve their present implementation.

The user has approved one editable location per document. Opening an already
open document elsewhere focuses its existing editor. Both editor groups and
folder editing remain useful, but do not require multiple synchronized editors
for the same document.

Lexical is the editing engine. Fractal is the native project/storage API. Keep
Tauri and React. Do not spend this project on GPUI, another editor engine,
another document format, or a new general application framework.

This plan supersedes the implementation direction and conflicting requirements
of [the original data-flow plan](document-dataflow-plan.md) and
[the revisit plan](document-dataflow-revisit-plan.md). Their measurements and
regressions remain evidence. Their completion labels do not establish that
this replacement is complete. [architecture.md](architecture.md) describes the
old implementation until it is rewritten at the final gate.

The end state matters. Milestones organize work and evidence across sessions;
they are not reasons to retain incompatible old machinery. Intermediate work
may be incomplete on a development branch. Do not ship two competing runtimes.

## Problem and intended result

Reported failures are typing stalls, buffered input, editor reloads and caret
resets during typing, and false external-change conflicts caused by our own
writes. Lexical alone is already known to edit substantial text responsively.
The design problem is the work and competing ownership surrounding it.

Today content travels through Lexical, source/body buffers, snapshot callbacks,
project publications, and save reconciliation. Safeguards try to distinguish
legitimate replacements from stale echoes. Multiple views and independent
save/recovery scheduling add more participants to the same update cycle.

The replacement is an in-memory document application that opens and saves
native Fractal documents. Editing must remain usable with storage disconnected,
slow, or failing. File serialization is an output operation. It is not the
language through which application features communicate.

Success means ordinary typing does bounded local work; background consumers
cannot overwrite the document or build an unbounded backlog; saving cannot
reload the editor; and adding a feature does not implicitly subscribe it to
every keystroke or every project update.

## Non-negotiable architecture rules

1. Exactly one live editable model and one Lexical editor per open document.
   Do not introduce a parallel custom rich-text tree beside Lexical.
2. A document session outlives view mounting and owns editor/history lifetime.
   Navigation, save completion, and path changes cannot recreate it.
3. Initial open and explicit replacement commands are the only ways to import
   native content. Ordinary prop changes, snapshots, polls, and save results
   have no content-installation capability.
4. Snapshot capture is a read. It never invokes a content-change callback,
   increments the document revision, or publishes HTML into workspace state.
5. Save acknowledgements update persistence metadata, never live editor content.
6. Ordinary typing cannot synchronously serialize the full document, scan the
   project, invoke storage, rebuild every derived model, or render the workspace.
7. React renders subscriptions and issues commands. React effects and component
   mounting do not drive persistence correctness or the document lifecycle.
8. Native project writes go through `fractal::Project` and expected section
   hashes. No direct-file workaround or second durable project/page format.
9. Source, serialized snapshots, and derived caches have explicit purposes and
   revisions. They are never independently editable authorities.
10. Async identity and write-integrity checks stay at operation boundaries.
    Do not remove actual data-loss protection to reduce line count.

## Ownership and dependencies

```text
Workspace/navigation ----commands----> Document runtime
       ^                                   |
       | small subscriptions               | read-only revision capture
       |                                   v
       +------------------------- Persistence coordinator
                                           |
                                  Native storage adapter
                                           |
                                    fractal::Project

Document runtime ----change summaries----> Derived features
```

| Owner | Authoritative state | Must not own/do |
| --- | --- | --- |
| Document runtime | Stable session ID, Lexical editor, title, edit revision, undo lifetime, editability | Saved source as a second live model; project refresh on edits |
| Persistence coordinator | Accepted native baseline, section hashes, saved/drafted checkpoints, in-flight operations, failures | Editor replacement; workspace navigation |
| Workspace | Document references, tabs/groups/folders, active location, navigation history | Body HTML/source; duplicate document revisions |
| Project service | Fractal handle, operation ordering, catalog metadata and receipts | Live Lexical state |
| Derived features | Disposable revision-tagged counts, headings, text/search caches | Editing authority; persistence scheduling |

Use direct typed methods and narrow subscriptions. No generic event bus,
repository framework, command-sourcing platform, CRDT, or plugin architecture
is required for this work. Suggested module boundaries are `DocumentSession`,
`DocumentRegistry`, `DocumentPersistence`, and `ProjectCommands`; names may
change, but ownership must not.

### Document identity and lifetime

- Allocate an opaque in-memory document ID. Maintain a separate path lookup.
  Paths are mutable addresses, not editor identity or React keys.
- Scope operations to a project session lifetime. Reopening the same root must
  not allow replies from the previous lifetime to mutate the new one.
- Allocate a replacement generation only for explicit content replacement.
  Keep these identity checks in runtime/storage boundaries, not in every UI.
- Open deduplicates concurrent loads and imports once. Recovery selection must
  finish before enabling editing, so startup recovery cannot later overwrite
  an active document.
- Switching tabs retains the same editor, history, and selection. Warm
  activation reads no file and imports no source.
- Default behavior for duplicate opening is focus-existing, including folder
  editors. If that location is hidden, reveal it. Creating a second editor and
  making it read-only is not an acceptable substitute.
- Preserve open sessions; dispose on actual document close after obligations
  settle. No retained disposed editors or detached-view attachment registry.
- View detachment must settle composition and retain editor/history state.
  Prove this against Lexical's actual mounting behavior. Mounting must not be
  necessary for save or recovery to find the document controller.

### Editing and feature contracts

All content changes, including paste, replace-all, toolbar actions, and AI/tool
edits, go through document commands. Body transactions advance one session edit
revision. Title changes go through the same session, with consistent snapshot
capture. Selection, decoration, and cache updates do not advance it.

Keep rich-text undo in Lexical. Define and test title undo without a second
rich-text history implementation. A save never changes undo history. An
explicit reload may reset history, and must communicate that destructive choice.

A typing transaction updates the affected editor content, records the revision
and affected regions, and schedules consumers. It does not await those consumers.

| Consumer | Subscription/work contract |
| --- | --- |
| Tab/status | Title, dirty transition, save/error state; not a revision-driven workspace render |
| Counts | Changed regions; coalesced fallback recount when required |
| Outline | Heading-relevant changes; no full document scan per character |
| Find/search | Revision-tagged text; cancellable/coalesced work; edits apply through commands |
| Catalog/explorer | Project metadata and path changes; body-only saves do not invalidate title indexes |
| Link decoration | Affected content/target changes; decoration cannot become a user edit |
| Folder previews | Bounded subscribed projections; no hidden editor per preview |
| AI/Borealis reads | Explicit live-document query for open pages; saved fallback for closed pages |

Noncritical views may briefly lag typing, but must carry freshness internally
and never replace a newer result with an older one. Do not use `startTransition`
as evidence that synchronous parsing or serialization became nonblocking.

## Persistence contract

### Capture, encode, write, acknowledge

Separate four operations:

1. Capture a consistent immutable editor state, title, identity, and revision.
2. Encode the captured content and required native sections.
3. Write through Fractal using the accepted expected hashes.
4. Acknowledge precisely what committed and update only persistence metadata.

The captured object must not later read the current title, path, or live editor
to fill in missing fields. Address resolution for a queued write belongs to the
coordinator; renames cannot redirect a stale operation to the wrong document.

Keep untouched native source/sections in the persistence baseline. Preserve
style, metadata, and protected content. Native source needed for recovery is
constructed at this boundary, not on every keystroke. Unsupported documents
remain protected; do not silently normalize away unsupported markup.

Only one conflicting write runs at a time per document, and project mutations
obey backend project ordering. Maintain at most one running capture/encoding
job and one latest requested revision per document. Bound total background
concurrency. Reuse a captured/encoded revision across save and recovery.
Coalescing never cancels or pretends to undo a write already committed to disk.

If revision 12 is saved while the user reaches 13, acknowledge 12 and leave 13
pending. Do not import 12, clear all dirty state, or immediately loop forever
trying to catch up with continuous typing. Save explicitly captures a target;
Save All captures a finite set of target revisions. Close has its own barrier.

Native sections may commit separately. Record successful section hashes and
values even if a later section fails. Do not acknowledge the whole revision
until all its required changes committed. Preserve original expected hashes
for unsent sections; a returned project snapshot cannot authorize overwriting
an intervening external change. Retrying must not resend an already committed
rename against the old path.

Use a small explicit result contract: acknowledged revision/sections, new
hashes, path/catalog changes, warnings, and failure outcome. If Fractal returns
content internally, the adapter may use it to maintain persistence baselines;
it must not publish that content into the editor. Separate catalog and document
loading types; retire active-document source fields from generic project state.

### Scheduling and UI-thread cost

One coordinator owns scheduling for autosave and recovery. Separate deadlines
are allowed; separate state machines observing React buffer copies are not.

Initial policy: autosave after 900 ms idle with a 2 s maximum request wait;
recovery request by 1.5 s with a target of confirmation within 2 s on the
supported fixture matrix. These are explicit starting policies, not proof of
latency or durability. Track confirmed completion, not timer firing. Slow
storage must not stop editing; report delayed/failed persistence and bound
retries. Autosave-off still permits recovery.

Full HTML export is presently synchronous. Merely moving it to a timeout or
calling it “background” does not meet this plan. Measure capture, encoding,
transfer, and native reconstruction separately. First eliminate redundant
work; if encoding still exceeds the foreground budget, implement and verify a
bounded/incremental encoder or worker-compatible serialization path with the
same semantics. Do not invent a second live document model to accomplish this.
Worker preparation and transfer costs count. This is a required engineering
gate, not a reason to silently weaken recovery or large-document targets.

### Recovery and close

- Drafts remain native source in app data, with revision and baseline metadata.
  Preserve existing draft readability; add metadata compatibly if necessary.
- Draft writes, moves, and cleanup are ordered. Saving revision N cannot delete
  a newer draft. An older draft completion cannot resurrect a cleaned checkpoint.
- A confirmed draft means the storage operation completed, not that encoding
  started. Failed saves retain both the live document and available recovery.
- Close settles composition, briefly stops new edits for the closing document,
  captures a final revision, and awaits the required save or explicit discard.
  Failure/timeout leaves it open and resumes editing. Never chase an indefinitely
  moving revision and never interpret missing controllers as successful saves.
- Project/window close uses a finite barrier across affected documents. A
  deliberate discard is distinct from save success and cleans drafts in order.
- Process termination recovery and power-loss durability are different claims.
  Record exactly which fault cases are tested; do not claim untested guarantees.

### External changes and uncertain writes

External observation does not import content. Initial policy for all open
documents is notify and offer explicit resolution, even if locally clean.
Closed-document metadata may refresh normally.

Own-write detection is based on ordered operation acknowledgements and hashes,
not “ignore watcher events for 500 ms.” Discard/recheck an observation taken
against a baseline that changed while the observation was running. Expected
section hashes remain the final protection when an external process races a
write. Include external changes to untouched sections in baseline/recovery
handling; do not mislabel our writes as conflicts or silently overwrite theirs.

Conflict choices are explicit reload/discard-local or explicit replace-external.
Capture the current local revision before replacement; the force path still
uses a freshly established conditional baseline and can conflict again.
Deletion keeps the session available for recovery/recreation. Recreation must
capture current live content, not an old serialized buffer.

`mutation_committed`, `indeterminate`, and `recovery_required` are not ordinary
failed writes. Reconcile the outcome under project ordering before retrying.
Retain local content throughout. Never blindly retry a possibly committed
structural operation. Stale UI replies cannot undo a committed disk mutation.

## Fractal feature scope and structural commands

Fractal remains the authority for native format semantics, path derivation,
link rewriting, transactions, and exports. Audit the pinned API before coding;
do not assume a receipt contains information it does not contain. Existing
Fractal capabilities remain in scope. The approved simplification concerns
editor ownership, not removal of project features.

| Operation family | Required runtime treatment |
| --- | --- |
| Open/create/duplicate | Establish native identity/baseline; initialize a session only when opened |
| Body/style/metadata write | Persistence consumer; section acknowledgement; no editor reload |
| Page title | Local title editing is immediate; persisted title may be a structural operation because Fractal derives paths/rewrites links |
| Move page/folder, rename folder | Explicit ordered project command; update address lookup and navigation references without changing session identity |
| Delete page/folder | Explicit scope and dirty-document decision; retain sessions until result is known |
| Insert link | Open-document command for live content; Fractal-backed write for closed content; no disk-first edit followed by reload of an actively edited page |
| Recreate/repair | Explicit replacement/structural command with preserved local recovery and outcome handling |
| Export page/folder | Capture/save the finite selected target revisions, resolve resulting paths, then use Fractal export |
| Search/links/backlinks | Saved project queries plus explicit live overlays; documented freshness |
| Project inspect/recover/repair | Explicit project operations; do not reinstall all open documents as a side effect of catalog publication |

### Mandatory policy for link rewrites and title-driven paths

Do not hide this problem behind generic “reconciliation.” A structural command
may change other open documents on disk. The initial implementation uses an
explicit bounded barrier:

1. Determine rewrite scope from actual Fractal guarantees. If unknown, include
   all open project documents. Settle composition and suspend edits in scope
   while the command runs; expose the operation and restore editability on error.
2. Capture and persist pending edits using the ordinary coordinator. Structural
   commands are serialized; nested title saves cannot recursively enter barriers.
   Specify a deterministic section/order policy after auditing the API.
3. Execute the Fractal command and inspect its receipt. Update paths in place.
4. For affected open documents whose body actually changed, apply a verified,
   targeted editor transaction when the change can be represented safely.
   Otherwise require an explicit source-replacement decision. No routine save
   may invoke that fallback silently. Keep the original session recoverable.
5. Advance baselines only for verified outcomes, invalidate affected derived
   results, and resume editing. Unknown outcomes follow the uncertainty policy.

Undo cannot restore stale paths after a link rewrite. Tests must establish the
history policy: transform affected history safely if supported, or explicitly
tell the user that accepting source replacement resets history. Do not claim
undo preservation merely because the editor instance survived.

Title keystrokes never run structural commands. Commit title persistence as a
coalesced operation after title editing ends or on explicit save/close. Body
autosave must not repeatedly trigger project-wide rename barriers while the
title field is being edited. Snapshot title/body consistency and dirty status
must reflect this policy. Test the actual Fractal title semantics before
implementing the coordinator; a model where title save is “just metadata” fails.

This exceptional command path is intentionally separate from normal body
editing. It may involve deliberate waiting. It must not create a permanent
disk-to-editor synchronization channel.

## Code retirement map

These are responsibilities to remove, not promises to retain filenames.
Re-audit references at implementation time; this map describes the baseline.

| Current area | Required disposition |
| --- | --- |
| `useWorkspaceDocuments.ts` | Replace lifecycle ownership with the runtime; retain only thin UI binding if useful |
| `documents/documentBuffers.ts` | Remove live source/body/native-edit buffer authority; move accepted source/hashes to persistence |
| `HtmlBridgePlugin.tsx` | Replace reactive HTML bridge with explicit initialization and read-only capture; no snapshot-to-workspace callbacks |
| `sharedDocumentEditor.tsx` | Remove per-view editors, peer state copying, ownership transfer, mirror HTML and attachment synchronization |
| `editorFlush.ts` | Replace mounted-view discovery/flush protocol with direct runtime capture; keep composition handling where necessary |
| `documents/documentPersistence.ts` | Replace buffer/project merge saves with captured writes and acknowledgements |
| `documents/useDocumentDrafts.ts` | Replace React-observed duplicate schedules with coordinator-owned scheduling |
| `documents/useDocumentLoading.ts` | Explicit open/reload/recovery commands; remove project-publication-driven installation |
| `documents/useProjectFilePolling.ts` | External observation service with ordered baselines; no buffer ownership |
| Project/client types and reconciliation | Separate catalog, loaded source and receipts; remove generic active-page source propagation |
| Tabs, groups, folder views | Store document references; focus an existing owner; no source prop feedback |
| Derived models/query index | Keep only if they obey narrow subscriptions, bounded work and disposable cache ownership |

Delete obsolete compatibility branches, exports, tests that enforce old
internals, and debug helpers. Preserve regression scenarios as behavior tests
against the new runtime. A legacy adapter may exist during construction, but
it must be recorded below and removed before completion. Do not count a renamed
buffer with the same responsibilities as a replacement.

## Execution and progress ledger

Status values: `not started`, `in progress`, `blocked`, `verified`.
Only evidence of the exit criteria permits `verified`. Commit count, lines
written, type-check success, or a happy-path smoke pass are insufficient.

| ID | Work and exit criteria | Status | Evidence/commit |
| --- | --- | --- | --- |
| P0 | Audit actual Fractal commands, structural rewrite scope, title semantics, editor mounting and current feature callers. Record operation contracts and fixture baseline; no unresolved ownership decision hidden as an implementation detail. | not started | — |
| P1 | Implement standalone registry/session and one-editor lifetime. Edit, title, undo, switch, close/dispose and reopen work without persistence. No workspace body/source authority. | not started | — |
| P2 | Implement read-only capture, native encoding, coordinator, save/recovery and storage adapter. Slow/failing writes preserve editing; partial and uncertain results are handled; serialization meets budget. | not started | — |
| P3 | Implement explicit reload/conflict handling and project command policies, including title renames, rewrites, export, delete and recreation. Verify affected open documents and undo decisions. | not started | — |
| P4 | Cut workspace, folder editing, derived features and AI/tool consumers over to the runtime. Both groups support different documents; duplicate opening focuses the owner. Remove old runtime and all temporary adapters. | not started | — |
| P5 | Complete correctness/performance/fault evidence, audit deletion and dependencies, rewrite architecture docs, and record remaining platform limits honestly. | not started | — |

Dependencies: P1 follows P0; P2 follows P1; P3 follows P2; P4 may wire UI during
earlier work but cannot pass before P3; P5 follows all others. Do not optimize
or polish old paths as a substitute for implementing these milestones.

### Required session handoff

Every implementation session updates this document with:

- Milestone status and concrete changes, including deleted mechanisms.
- Commands run, pass/fail, fixture/build/environment, and artifact links.
- Remaining failures and next bounded task.
- Any temporary adapter, its consumers, and which milestone deletes it.
- Any proposed deviation and its reason. Product scope reductions, automatic
  content replacement, another durable format, or weaker acceptance targets
  require an explicit decision; do not silently redefine completion.

Keep detailed measurements in `docs/measurements/document-runtime-*.md` and
link them here. Avoid another series of plans that leaves this ledger stale.

Temporary adapters: none created yet.

Latest handoff: planning only. Next task is P0, then build the new session
runtime. The working tree at planning time contained an unrelated local edit
to `src/features/workspace/components/FolderView.tsx`; preserve user changes
when replacing surrounding code. Git history being available is not permission
to discard unrelated uncommitted work.

## Acceptance: correctness and architecture

Each scenario requires an assertion and evidence. Use deterministic runtime
tests for scheduling/order and the real desktop for editor interaction.

- [ ] Continuous typing through multiple save/recovery/poll cycles retains exact
  text, selection and undo. No HTML import after initial load.
- [ ] Slow saves and failed storage do not disable typing or cause repeated
  synchronous exports. Pending jobs remain bounded during sustained input.
- [ ] Save N while editing N+1 acknowledges only N. Out-of-order/stale replies,
  project reopen and explicit replacement cannot alter a newer session.
- [ ] Title/body capture is consistent; partial title/content success retains
  correct original hashes for unsent sections and resolves the resulting path.
- [ ] Own writes never produce external-conflict UI. Real external edit,
  deletion and change-during-save preserve local content and are not ignored.
- [ ] Type then immediately close/save-all/export includes the intended final
  revision. Composition is settled; timeout/write failure leaves the document.
- [ ] Switching tabs, opening in another group, and entering/leaving folder
  editing preserves the one editor, caret/history, and warm activation.
- [ ] Create, duplicate, title rename, move, delete, recreate, repair, link
  rewrite and exports obey the feature table, including dirty affected pages.
- [ ] Recovery after forced termination restores the latest confirmed draft;
  pending cleanup cannot delete a newer draft or revive an older one.
- [ ] Native untouched/protected sections survive; unsupported markup stays
  protected; no second project format or direct native writes exist.
- [ ] Open-document search/find/AI reads see local changes with explicit
  freshness; obsolete cache results cannot replace newer results.
- [ ] Opening/closing repeatedly does not retain disposed editors/listeners,
  schedules, snapshots, or document subscriptions.
- [ ] Static dependency audit finds no routine save-to-editor content path,
  workspace source authority, duplicate editor synchronization, or legacy adapter.

## Acceptance: responsiveness

Use representative native documents plus the existing deterministic 100k, 1m,
and 5m visible-character fixtures: short paragraphs, huge paragraphs, lists,
tables, headings, and dense links. Include the many-page project and several
open documents. Keep all sizes in the report; do not quietly drop failing cases.

Compare an isolated Lexical editor against the full new runtime on identical
fixtures, machine and build. This distinguishes engine/layout limits from
Amanite overhead. Every added feature must preserve the runtime's latency
budget; the isolated editor is a comparison, not permission to excuse failures.

| Measure | Target |
| --- | --- |
| Warm document activation | <= 50 ms; zero reads/imports |
| Cold first editable paint | <= 1,500 ms |
| Input-to-paint latency | p95 <= 50 ms |
| Longest foreground stall during typing and pauses | <= 100 ms |
| Confirmed recovery lag under normal storage | <= 2,000 ms |
| Full export/parse caused directly by a keystroke | 0 |
| Routine save/recovery-triggered editor imports | 0 |
| Unrelated editor updates on a body edit | 0 |

Record at least 20 interaction samples per reported ordinary case and a
sustained typing run of at least 60 seconds through multiple persistence cycles.
Include automated input and manual desktop typing. Report median, p95, maximum,
timeouts, capture/encoding cost, confirmed persistence lag, and queue bounds.
Record hardware, OS/display backend, webview, commit, fixture identity, build
profile and sample counts. Include worker preparation and UI-thread transfer
costs. Debug smoke timings alone do not establish production performance.

Run normal and deliberately slow/failing storage. Normal-storage recovery
targets do not mean impossible guarantees under indefinitely stalled I/O;
under fault injection the requirements are continued editing, retained content,
bounded work, visible failure and correct retry/close behavior.

Test Windows and Linux, recording Wayland/X11 separately where available. Real
IME checks are distinct from synthetic composition tests. Missing platforms
remain unverified; do not claim cross-platform acceptance. Document macOS
coverage where available. If a target fails, leave the gate open, identify the
measured cause, and fix it or obtain an explicit scope/target decision.

## Verification commands and final gate

Follow repository `AGENTS.md`. For desktop verification start with:

```sh
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
pnpm run tauri:webdriver:open
```

Use the embedded real Tauri WebDriver, not browser mock mode or Playwright/CDP.
Build through `pnpm exec tauri build --debug --no-bundle --features webdriver`.
Only use smoke `--skip-build` after a valid build of the current changes. Keep
WebDriver test-only. Extend the desktop scenarios for this plan instead of
assuming the existing smoke suite covers it. Artifacts live under
`artifacts/tauri-webdriver/`.

Run appropriate focused tests during implementation. At the final gate run
`pnpm test`, `pnpm run build`, Rust tests via
`cargo test --manifest-path src-tauri/Cargo.toml`, and desktop verification.
Maintain independent exact-content/native-integrity assertions; do not write
tests that merely repeat the new implementation's internal logic.

Completion requires P0–P5 verified, architecture/correctness checks satisfied,
performance evidence against the declared matrix, deleted old runtime and
adapters, updated architecture documentation, and an honest list of remaining
platform limitations. A green test suite with unchanged ownership is failure.
A simpler architecture with lost edits is also failure.

## Decision record

| Date | Decision | Basis |
| --- | --- | --- |
| 2026-09-16 | Replace document lifecycle rather than patch existing synchronization | User explicitly requested an architectural reset; repeated fixes reintroduced failures |
| 2026-09-16 | Keep Lexical, Fractal, Tauri and React for this project | Lexical editing is already responsive; surrounding data flow is the target |
| 2026-09-16 | One editable location per document; focus existing owner | User approved the simplification |
| 2026-09-16 | Existing implementation need not be preserved | User prioritizes the end state and has the baseline in Git |
| 2026-09-16 | Keep Fractal native persistence and feature semantics | Repository boundary and user's stated Fractal feature scope |

Implementation discoveries and approved deviations belong below this table.
