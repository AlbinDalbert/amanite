# Amanite GPUI hybrid experiment plan

Status: proposed experiment

This plan tests whether Amanite should move from a Tauri and React application to
a GPUI application with Lexical isolated inside an embedded webview. It has two
checkpoints:

1. A fail-fast checkpoint that proves or rejects the platform, webview, bridge,
   document-lifecycle, and large-document assumptions.
2. A complete-hybrid checkpoint that ports the full Amanite application except
   for the rich editor itself.

The experiment belongs on a long-lived branch such as
`experiment/gpui-hybrid`. It does not replace the Tauri application on `main`,
remove the existing desktop harness, or change Fractal's native document format.

## Decision to be made

The experiment must answer this question:

> Should GPUI own the Amanite desktop application while an embedded Lexical
> webview remains the rich-document editor?

The answer is not determined by whether the GPUI shell looks good. The hybrid
must also simplify state ownership, preserve every Fractal persistence rule,
handle large documents without unnecessary complete-document work, and behave
correctly on Linux, macOS, and Windows.

At the end of each checkpoint, record one of these decisions:

- Continue to the next checkpoint.
- Keep the work as an experiment and revisit a named blocker later.
- Abandon the hybrid and retain the Tauri application.

Completing checkpoint 2 does not authorize merging the hybrid to `main`. Product
replacement, release migration, and removal of the Tauri application require a
separate decision after the experiment has passed.

## Product and data decisions

These decisions remain fixed during the experiment. Changing one requires an
explicit plan revision.

1. Amanite remains a slim word processor. Its target sits between Obsidian and
   Microsoft Word rather than becoming a source-code editor or a plain Markdown
   editor.
2. Fractal defines the product's durable document scope. Amanite continues to
   edit native `*.fractal.html` documents only.
3. Every durable project and page mutation goes through `fractal::Project` and
   its section hashes. The experiment must not introduce a second durable page
   format.
4. The existing formatting breadth is legitimate product scope. The experiment
   does not justify removing formatting merely to make the port easier.
5. GPUI owns the application window, project session, navigation, workspace,
   non-editor UI, save coordination, drafts, conflicts, and Fractal calls.
6. The webview owns only the live rich-editor session and UI that requires
   direct Lexical selection access.
7. React must not remain a second application shell inside the webview. The
   webview bundle contains the editor and its bridge, not the workspace.
8. Tauri remains the reference implementation until the complete hybrid passes.
   The experiment may reuse behavior and tests, but it must not destabilize the
   reference while proving GPUI.
9. The experiment may use GPUI Kit or its unstyled base for common behavior.
   It must not depend on Zed's application-specific `ui`, editor, project, or
   workspace crates.
10. GPUI, GPUI Kit, and webview dependencies use exact versions or revisions.
    Dependency updates happen as deliberate work, never through a wildcard.
11. Mobile and browser products are out of scope. The webview is an internal
    editor implementation, not a promise of a browser version.
12. A future native GPUI editor must be able to replace the web editor without
    rewriting the workspace. The host-facing editor contract must not expose
    Lexical node types or browser DOM objects.

## Why the hybrid exists

The hybrid separates two migrations that do not need to happen at the same
time:

1. Move the Amanite desktop application and session model to Rust and GPUI.
2. Replace Lexical with a native, incremental GPUI rich editor.

The first can succeed while the second remains future work. Lexical keeps the
editing behavior Amanite already depends on, including selection, composition,
undo history, formatting, links, lists, tables, and spellcheck. GPUI can still
own the rest of the application and call Fractal directly.

## Target architecture

### Durable authority

Fractal remains the only durable authority:

```text
native *.fractal.html files
        |
        v
fractal::Project
        |
        v
typed project snapshots, native sections, hashes, receipts, and reports
```

Recovery drafts live in Amanite app data. They remain temporary recovery data
and never become another project format.

### GPUI application ownership

The GPUI application owns:

```text
Application
  |
  +-> project catalog and active Fractal snapshot
  +-> workspace groups, tabs, history, and focus
  +-> one DocumentSession per open page path
  +-> base hashes, dirty revision, saved revision, and conflicts
  +-> draft and autosave scheduling
  +-> project polling and mutation-receipt reconciliation
  +-> settings, health, exports, and Borealis
  +-> embedded editor hosts
```

Each project-relative page path has one logical `DocumentSession`. Opening the
same page in both editor groups must not create independent dirty state, draft
state, or save queues.

### Web editor ownership

The embedded web editor owns:

```text
WebEditorSession
  |
  +-> Lexical document tree
  +-> selection and composition
  +-> undo and redo history
  +-> current formatting state
  +-> rich document canvas
  +-> formatting controls that require direct selection access
  +-> link picker and editor-local overlays
```

The editor must not call Fractal, access project files, own project navigation,
write recovery drafts, or decide whether a save succeeded.

### Versioned editor protocol

GPUI and the editor communicate through a versioned, typed protocol. Every
message envelope contains at least:

```text
protocol_version
editor_session_id
project_root_id
page_path
```

Requests that expect a reply also contain a unique `request_id`. Messages about
editable content contain an `editor_revision`.

Initial host-to-editor messages include:

```text
LoadDocument
SetReadOnly
RequestSnapshot
UpdateKnownPages
UpdateAppearance
ExternalConflict
FocusEditor
DisposeSession
```

Initial editor-to-host messages include:

```text
EditorReady
DocumentChanged
SnapshotReady
TitleChanged
OutlineChanged
CountsChanged
OpenPage
OpenFolder
OpenExternal
EditorFocused
ProtocolError
```

The exact wire representation may be JSON during the experiment. Both sides
must validate message type, protocol version, session identity, path identity,
and required fields before changing state.

`DocumentChanged` reports a revision and small derived metadata. It must not
carry complete HTML. GPUI requests a serialized snapshot only when it needs one
for a draft, autosave, explicit save, tab eviction, project mutation, or window
close.

### Document session state

The GPUI document session keeps these concepts separate:

```text
base_source
    Complete source last accepted from Fractal.

base_parts
    Fractal title, content, style, and metadata values with their hashes.

current_revision
    Latest revision reported by the editor.

latest_snapshot
    Most recent title and content HTML received from the editor, tagged with
    its revision.

saved_revision
    Latest editor revision confirmed by Fractal.

drafted_revision
    Latest editor revision confirmed in recovery storage.
```

A document is dirty when `current_revision > saved_revision`. A document needs
a newer recovery draft when `current_revision > drafted_revision`.

The session never marks revision `N + 1` clean because a save of revision `N`
completed. Path changes caused by title edits must move the session identity,
tabs, history, drafts, and queued requests as one reconciled operation.

### Snapshot and save flow

```text
1. GPUI requests a snapshot for the current editor revision.
2. Lexical serializes title and content HTML once.
3. The editor returns the snapshot with its exact revision.
4. GPUI writes a complete recovery draft or starts a Fractal section save.
5. Editing may continue while the write is in flight.
6. GPUI applies the returned receipt and records the confirmed revision.
7. If the editor has a newer revision, the document remains dirty.
```

Snapshot requests coalesce. A slow snapshot or save must not create an unbounded
queue of obsolete work.

### Complete source and drafts

The editor returns editable title and content sections. GPUI combines the
snapshot with the last accepted native source when it needs a complete recovery
document. That reconstruction runs outside the foreground render path.

The reconstruction must preserve unedited style and metadata sections and must
produce a native document accepted by Fractal. Live project writes still use
Fractal section operations rather than whole-file replacement.

### Multiple views of one page

A page can appear in both editor groups and inside folder views. The hybrid must
not silently create unrelated Lexical models for the same logical page.

Checkpoint 1 must choose and prove one of these implementations:

- One live editor session with one editable surface and synchronized read-only
  mirrors.
- Multiple editable surfaces driven by one shared web editor session and one
  transaction stream.
- One web application that hosts multiple views over a shared logical Lexical
  state.

Independent models synchronized through periodic complete HTML are forbidden.
If no practical shared-session design works, the checkpoint fails unless the
product explicitly accepts one editable surface per page.

## Execution rules

- Complete work packages in order within each checkpoint.
- Keep the Tauri application runnable throughout checkpoint 1.
- Do not port secondary UI before the fail-fast exit review.
- After checkpoint 1 passes, port all current non-editor product behavior.
- Preserve unrelated work in the repository.
- Add tests with each behavior rather than postponing them until parity review.
- Record measurements, screenshots, platform notes, and known failures under an
  experiment artifact directory that is ignored by release packaging.
- Do not claim a performance improvement without recording the reference and
  hybrid results on the same machine and document fixture.
- Do not hide unsupported behavior behind a successful-looking no-op.
- Keep blocking filesystem and Fractal work off the GPUI foreground thread.
- Keep editor protocol handlers small. Business rules belong to Rust session
  types, not message dispatch code.
- Keep the editor bundle network-isolated. Borealis networking stays in Rust.
- Treat webview content as untrusted input at the protocol boundary even though
  Amanite supplies the bundle.

## Progress

| ID | Work package | Status | Depends on |
| --- | --- | --- | --- |
| F1 | Establish the isolated experiment and baselines | Not started | None |
| F2 | Prove GPUI on the desktop targets | Not started | F1 |
| F3 | Prove the embedded Lexical host | Not started | F2 |
| F4 | Implement the versioned editor protocol | Not started | F3 |
| F5 | Prove the document lifecycle through Fractal | Not started | F4 |
| F6 | Run the fail-fast review | Not started | F1 through F5 |
| H1 | Establish Rust application state and services | Not started | F6 passes |
| H2 | Build the Amanite GPUI design system and shell | Not started | H1 |
| H3 | Port project entry and catalog behavior | Not started | H1, H2 |
| H4 | Port workspace groups, tabs, and navigation | Not started | H2, H3 |
| H5 | Port pages, folders, search, and exports | Not started | H3, H4 |
| H6 | Complete editor-hosted document behavior | Not started | H4, H5 |
| H7 | Port settings, health, and Borealis | Not started | H2, H5 |
| H8 | Reach behavioral parity and cross-platform confidence | Not started | H1 through H7 |
| H9 | Run the complete-hybrid review | Not started | H8 |

## Checkpoint 1: fail-fast GPUI hybrid

Checkpoint 1 exists to reject a bad architecture before the project pays for a
complete port. It proves the GPUI dependency path, embedded webview behavior,
editor protocol, document lifecycle, and large-document behavior using real
Fractal projects.

### F1. Establish the isolated experiment and baselines

Goal: make the experiment reproducible and define what it must beat or preserve.

Changes on the experiment branch:

- Create a separate GPUI binary and editor-web bundle without replacing the
  Tauri entry point.
- Keep experiment code in clearly named application and editor directories.
- Pin exact GPUI, GPUI Kit, and webview dependency versions or revisions.
- Record licenses and the reason for every direct Git dependency.
- Document Linux, macOS, and Windows build prerequisites.
- Add commands for building and launching the experimental binary.
- Add deterministic document-fixture generation rather than committing huge
  generated documents.
- Capture the reference Tauri behavior and measurements before changing shared
  code.

Reference fixtures:

- A small document exercising every supported element and attribute.
- A document with many headings, derived links, and explicit links.
- A document with nested lists and tables.
- A Fractal-invalid document.
- A Fractal-valid document the editor cannot preserve.
- Large documents at approximately 100,000, 1,000,000, and 5,000,000 visible
  characters.
- A project with enough pages and folders to exercise catalog, tree, search,
  links, and mutation receipts.

Reference measurements:

- Process startup to first usable window.
- Project open to usable workspace.
- Page request to editable editor.
- Keystroke-to-paint latency while typing continuously.
- Scroll frame times through a large document.
- Snapshot generation time and size.
- Draft completion time.
- Save completion time.
- Resident memory after opening and editing each large fixture.
- Time the application remains unresponsive during every measured operation.

Tests:

- Fixture generation is deterministic.
- The supported-element fixture passes Fractal validation.
- Reference documents exercise every current editor node and formatting action.

Exit criteria:

- A baseline report identifies machine, OS, build profile, fixture size, and
  measurement method.
- The Tauri reference remains runnable.
- The experiment has independent build and launch commands.
- Dependencies are pinned and explained.

### F2. Prove GPUI on the desktop targets

Goal: confirm that GPUI can host Amanite's basic desktop behavior before adding
the web editor.

Changes:

- Open a decorated or custom-titlebar GPUI window with Amanite's minimum size.
- Add a small Amanite theme using the existing color, spacing, typography, and
  document tokens.
- Render a temporary sidebar, tab row, split area, status area, dialog, menu,
  tooltip, and resizable divider.
- Exercise keyboard actions, focus traversal, clipboard access, file selection,
  save selection, external URL opening, and path revealing.
- Run Fractal project open and page read work on a background executor.
- Update GPUI entities on the foreground thread after background work completes.
- Add a crash-visible error path for background task failures.

Tests:

- GPUI unit tests cover actions, focus changes, split resizing, and async result
  publication.
- Opening a project does not block animation or input in the shell.
- Closing the window can delay shutdown while a test guard resolves.

Exit criteria:

- The experiment builds on Linux, macOS, and Windows CI or dedicated test
  machines.
- A real interactive smoke session passes on every desktop target available to
  the project.
- Wayland and X11 are both exercised before checkpoint 1 closes.
- File dialogs, clipboard, URL opening, and path revealing work on the supported
  desktop targets.
- No Fractal or filesystem operation runs on the foreground render thread.

### F3. Prove the embedded Lexical host

Goal: determine whether an embedded webview can behave like a contained GPUI
editor component rather than a second application window.

Changes:

- Build an editor-only web bundle from the current Lexical editor.
- Remove project loading, Tauri invokes, global workspace state, settings
  persistence, and Borealis from that bundle.
- Embed one editor inside a GPUI layout.
- Resize, hide, show, focus, and dispose the editor repeatedly.
- Verify clipping, stacking, high-DPI scaling, scroll behavior, theme changes,
  and redraw after window occlusion.
- Route editor requests for page, folder, and external-link navigation to GPUI.
- Keep selection-sensitive formatting controls inside the webview for this
  checkpoint.
- Test whether multiple webview/editor surfaces can coexist without focus,
  z-order, memory, or lifecycle failures.
- Test the same logical page displayed in two locations and select the shared
  session design described above.

Interaction tests:

- Typing, selection, copy, cut, paste, undo, and redo.
- CJK IME composition.
- Dead keys and composed Latin characters.
- Emoji and multi-code-point graphemes.
- Right-to-left text entry and selection.
- Spellcheck on each desktop platform where the embedded engine supplies it.
- Table navigation and formatting shortcuts.
- Mouse, trackpad, keyboard, and context-menu interaction.
- Focus transfer between GPUI controls and the editor.
- Application shortcuts while the editor has focus.
- Editor-local shortcuts that must not trigger GPUI actions.

Exit criteria:

- The editor behaves correctly when embedded, resized, covered by an overlay,
  hidden, restored, and disposed.
- Focus and shortcuts have a documented routing rule with no known double
  dispatch.
- IME, clipboard, selection, and undo pass on Linux, macOS, and Windows.
- Multiple editor surfaces have a viable lifecycle and ownership model.
- The implementation does not require keeping the old React workspace alive.

Immediate stop conditions:

- The webview cannot clip or stack correctly inside the required GPUI layouts.
- Input, IME, clipboard, or focus is unreliable on a target desktop OS.
- Multiple required editor surfaces cannot share one logical document safely.
- The only workable design embeds the complete React application rather than
  the editor alone.

### F4. Implement the versioned editor protocol

Goal: replace incidental JavaScript callbacks with a tested contract between
GPUI and the editor.

Changes:

- Define the protocol schema in one language-neutral document.
- Define matching Rust and TypeScript message types.
- Include protocol version, session identity, page identity, revision, and
  request identity where required.
- Reject stale-session and wrong-page replies.
- Add request timeouts and explicit cancellation for disposed sessions.
- Coalesce snapshot requests and discard superseded replies safely.
- Send `DocumentChanged` without serializing HTML.
- Send derived outline, count, and formatting state separately from snapshots.
- Make malformed messages visible in experiment diagnostics.
- Make protocol logging redact document content by default.

Tests:

- Shared JSON fixtures decode to the same meaning in Rust and TypeScript.
- Unknown protocol versions fail with an actionable diagnostic.
- Unknown message types do not mutate application state.
- A reply for a disposed session is ignored.
- A snapshot for revision `N` cannot overwrite revision `N + 1`.
- Reordered, duplicated, delayed, and missing messages leave the session in a
  defined state.
- `DocumentChanged` payload size stays bounded as document size grows.

Exit criteria:

- Every message has one documented owner and handler.
- Rust tests and editor-web tests cover the same contract fixtures.
- Normal typing sends bounded change notifications rather than complete HTML.
- Session disposal leaves no unresolved request or retained webview reference.

### F5. Prove the document lifecycle through Fractal

Goal: edit, draft, save, conflict, rename, and close a real native page without
data loss.

Changes:

- Open a Fractal project directly from Rust.
- Load native title and content sections into an editor session.
- Track current, snapshotted, drafted, and saved revisions independently.
- Request snapshots for recovery drafts and saves.
- Reconstruct complete native source for drafts outside the render path.
- Save title and content through Fractal section APIs and expected hashes.
- Reconcile mutation receipts, including title-derived path changes.
- Keep edits made during an in-flight save dirty and queue the newer revision.
- Detect external changes and place dirty sessions into conflict state.
- Support reload, replace-external-version, and recreate-missing-page choices.
- Flush or safely cancel work during tab close, project close, and window close.
- Keep one save queue and one draft identity per logical page.

Required failure simulations:

- Editor changes while a snapshot request is in flight.
- Editor changes while a Fractal write is in flight.
- Title save succeeds and content save conflicts.
- Fractal returns `mutation_committed`.
- Fractal returns `indeterminate`.
- Project enters `recovery_required`.
- Page is renamed by title mutation.
- Open page disappears from disk.
- External content changes while the editor is dirty.
- Draft storage fails.
- Webview crashes or becomes unresponsive while dirty.
- Window close occurs with unsnapshotted edits.

Tests:

- Revision state-machine tests cover every ordering above.
- Fractal integration tests verify section hashes and mutation receipts.
- Draft recovery restores the latest confirmed draft snapshot.
- A saved revision never marks a newer editor revision clean.
- Path changes move the session, tabs, history, queues, and draft exactly once.
- Unsupported and invalid documents remain unchanged until an explicit Fractal
  repair action.

Performance checks:

- Typing does not generate complete HTML until a snapshot is requested.
- Snapshot generation cannot block GPUI shell input.
- The 100,000 and 1,000,000 character fixtures are editable without a dataflow
  regression relative to the Tauri reference.
- The 5,000,000 character fixture records an honest result even if the editor
  cannot yet provide acceptable interaction.
- Bridge traffic, snapshot cost, memory, and unresponsive time are reported.

Exit criteria:

- Real Fractal pages can be edited, drafted, saved, renamed, conflicted,
  recovered, and closed without data loss.
- Every durable write goes through Fractal.
- The common typing path sends no complete-document payload.
- The shutdown handshake has a bounded failure mode and tells the user when
  Amanite cannot confirm a draft.
- Large-document results meet the agreed reference threshold or identify a
  specific editor limitation that the hybrid does not worsen.

### F6. Run the fail-fast review

Goal: decide whether the project should pay for the complete non-editor port.

Review evidence:

- Dependency and maintenance assessment.
- Platform build and smoke results.
- Webview focus, clipping, lifecycle, and multi-surface results.
- Protocol contract and test results.
- Fractal lifecycle and failure-simulation results.
- Side-by-side performance report against Tauri.
- Known accessibility and spellcheck differences.
- Estimated work remaining for checkpoint 2.

Pass conditions:

- No immediate stop condition remains.
- The webview contains only editor responsibilities.
- State ownership is simpler and written down.
- The revision protocol survives delayed and reordered work.
- Cross-platform behavior is credible enough to continue.
- Large-document behavior is no worse because of the hybrid bridge.
- The remaining port is ordinary product work rather than unresolved platform
  research.

Failure conditions:

- Correctness requires continuous complete-HTML synchronization.
- GPUI and the editor both need to act as authority for the same session state.
- Required editor layouts cannot work with embedded webviews.
- A supported desktop OS has an unresolved input or lifecycle failure.
- Fractal conflict and close behavior cannot be made deterministic.
- Dependency churn makes a pinned, reproducible build impractical.

Exit artifact:

- Add a dated checkpoint decision to this file with the chosen outcome,
  evidence links, remaining blockers, and approved next work package.

## Checkpoint 2: complete GPUI hybrid

Checkpoint 2 ports the complete Amanite product except for replacing Lexical.
Feature parity means preserving user-visible behavior and Fractal guarantees. It
does not mean translating each React hook, component, or CSS selector into a
Rust equivalent.

### H1. Establish Rust application state and services

Goal: give each piece of project and workspace state one Rust owner.

Changes:

- Separate reusable Fractal, catalog, draft, AI, and platform operations from
  Tauri command wrappers.
- Keep the Tauri reference compiling while shared core code is extracted.
- Define GPUI entities for application, catalog, project session, workspace,
  editor group, document session, settings, and Borealis state.
- Preserve the one-buffer-per-page and one-save-queue-per-page rules.
- Move receipt reconciliation and path mapping into tested Rust functions.
- Replace browser local storage with native settings storage.
- Replace Tauri runtime tasks with GPUI-compatible background work.
- Make cancellation and entity lifetime explicit for every async operation.

Tests:

- Core services run without Tauri or GPUI.
- Project and document state transitions are deterministic pure tests where
  practical.
- Dropping a project session cancels or detaches all obsolete task results.
- Receipt reconciliation covers pages, folders, tabs, history, drafts, and
  open document sessions.

Exit criteria:

- Tauri and GPUI can use the same Fractal core without IPC-shaped internals.
- No GPUI view owns durable business rules.
- Background work cannot publish into a replaced project session.

### H2. Build the Amanite GPUI design system and shell

Goal: reproduce Amanite's deliberate visual identity with a small component set
instead of porting CSS selector by selector.

Changes:

- Translate existing semantic colors, typography, density, radii, and document
  settings into typed theme values.
- Choose GPUI Kit styled controls, GPUI Base behavior, or Amanite-owned controls
  per component family.
- Build shared button, icon button, text input, menu, tooltip, dialog, tab,
  sidebar row, status, resizer, and empty-state components.
- Build the custom title bar and window controls.
- Support system, ember, moss, and ink appearance behavior.
- Support document font, text scale, line height, page width, paragraph gap,
  paragraph indent, and reduced-noise settings.
- Add focus, hover, pressed, disabled, error, busy, and selected states.
- Add accessibility roles, labels, values, and keyboard behavior while each
  component is introduced.

Do not:

- Copy Zed's application-specific UI crates into Amanite.
- Recreate all CSS abstractions in Rust.
- Add a general docking system when Amanite still supports two editor groups.
- Introduce multiple components that differ only cosmetically.

Exit criteria:

- The shell has one coherent Amanite theme and component vocabulary.
- Both light and dark system behavior are legible.
- Keyboard-only navigation reaches every shell control.
- The component gallery or test window covers every shared component state.

### H3. Port project entry and catalog behavior

Goal: replace the React start screen and session entry flow.

Behavioral scope:

- Scan the default Amanite project library.
- Keep healthy catalog entries visible when another entry is damaged.
- Create a project through Fractal.
- Open a project from the library.
- Open a project outside the library through a native directory dialog.
- Inspect before opening when required.
- Explain unsupported, invalid, and recovery-required projects.
- Recover interrupted Fractal transactions only after confirmation.
- Restore the last project when the stored path is still usable.
- Refresh the catalog after project creation, recovery, or close.

Exit criteria:

- Every current project-entry behavior has a GPUI acceptance test or recorded
  desktop smoke.
- The Tauri and GPUI versions report the same catalog and inspection results for
  the reference fixture.

### H4. Port workspace groups, tabs, and navigation

Goal: reproduce the two-group workspace with Rust-owned navigation state.

Behavioral scope:

- Left editor group and optional right editor group.
- Ordered tabs for pages, folders, and Borealis.
- Per-group active tab and navigation history.
- Focused-group behavior for quick open, explorer navigation, and close-tab.
- Tab reordering within a group.
- Tab movement between groups.
- Creating the second group by dragging to the right edge.
- Closing a group and preserving the surviving group.
- Reopening closed tabs.
- Shared document sessions when the same page appears in both groups.
- Sidebar, inspector, and center-divider resizing.
- Focus mode and sidebar toggling.
- Existing workspace keyboard shortcuts.
- Save-before-navigation, project mutation, project close, and window close.

Tests:

- Port the pure workspace transition cases to Rust.
- Test pointer and keyboard tab operations through GPUI.
- Test document path changes across both groups and their histories.
- Test a dirty page visible in two groups.

Exit criteria:

- Workspace behavior matches the reference without keeping parallel navigation
  state in the web editor.
- One logical page still has one dirty state, conflict state, draft, and save
  queue.

### H5. Port pages, folders, search, and exports

Goal: complete project manipulation outside the rich editor.

Behavioral scope:

- File explorer page and folder tree.
- Page create, duplicate, move, reveal, and delete.
- Folder create, title edit, reorder, and delete.
- Folder views with ordered children and missing-child reporting.
- Expansion of child pages into embedded rich-editor views.
- Missing-page removal and recreation behavior.
- Quick open and project search.
- Explicit links, backlinks, and derived-link navigation.
- Single-page HTML export.
- Folder HTML export selection and reports.
- Mutation warnings and partial-success reporting.
- Save-before-mutation rules.

Special requirement:

- Folder views can host more than one rich editor. Their editor sessions must
  obey the shared logical-session design selected in F3. Folder embedding must
  not create independent draft or save ownership.

Exit criteria:

- Every durable action calls Fractal exactly as required by the native boundary.
- Returned receipts determine state changes.
- Folder export and page export match Fractal's reference reports.
- Multi-editor folder views pass lifecycle, focus, and memory checks.

### H6. Complete editor-hosted document behavior

Goal: preserve the current word-processor behavior while keeping the webview
bounded to editing.

Editor scope to preserve:

- Native title and rich content editing.
- Undo and redo.
- Bold, italic, underline, strike-through, inline code, highlight, subscript,
  superscript, and supported text-case formats.
- Paragraphs, all supported heading levels, quotes, and code blocks.
- Ordered and unordered lists, indentation, and outdentation.
- Alignment controls.
- Explicit internal and external links.
- `@` page-link insertion.
- Derived page-title links without durable HTML changes.
- Tables and current row and column operations.
- Horizontal rules.
- Find and replace.
- Outline navigation.
- Word, character, paragraph, reading-time, and word-goal status.
- Spellcheck setting.
- Focus mode.
- Link inspector and backlinks.
- Invalid-document and incompatible-document protection.
- Exact-source display for protected documents.
- Explicit Fractal repair action.
- Editor loading state.

Ownership rules:

- GPUI owns project-aware inspector data and navigation decisions.
- The editor may render selection-sensitive controls and overlays.
- Derived-link matching may run in the editor, but GPUI supplies the known-page
  catalog and receives navigation requests.
- Counts and outline should update incrementally inside the editor where
  possible. Complete source analysis must not return to the typing path.
- Page and folder exports remain Rust and Fractal operations.

Exit criteria:

- The complete supported-element fixture can be edited and saved without losing
  supported structure or attributes.
- Every listed editor behavior matches the reference or has an explicitly
  accepted difference.
- The web bundle has no project persistence or application-shell code.

### H7. Port settings, health, and Borealis

Goal: complete the remaining non-editor application behavior in GPUI.

Settings scope:

- Appearance and document settings.
- Autosave, spellcheck, word goal, and editor preferences.
- Borealis endpoint and model selection.
- Session-only API key behavior.
- Application and locked Fractal revision diagnostics.

Health scope:

- Project inspection results.
- Recovery and repair actions.
- Draft-storage failures.
- Dirty, missing, and conflicted document sessions.
- Most recent mutation receipt and warnings.
- Explicit confirmation before recovery or repair.

Borealis scope:

- Read-only workspace integration.
- Chat history for the current session.
- Markdown response rendering in GPUI.
- Model listing and chat requests through Rust.
- Workspace context for both editor groups.
- Search and page-read tools.
- Unsaved editor snapshots taking precedence over disk content when available.
- Bounded page reads for large documents.
- Clear errors for unavailable or stale editor snapshots.

Exit criteria:

- Secrets never enter persistent webview storage.
- The web editor performs no network requests.
- Borealis sees the same workspace and unsaved-page meaning as the reference.
- Health state comes from Fractal reports and Rust session state rather than
  inferred webview UI state.

### H8. Reach behavioral parity and cross-platform confidence

Goal: prove the hybrid as a complete Amanite implementation rather than a demo.

Parity work:

- Build a feature matrix against the Tauri reference.
- Mark each behavior as matched, intentionally changed, blocked, or not
  applicable.
- Require a written reason and user impact for every intentional difference.
- Test keyboard shortcuts on macOS and Ctrl-based platforms.
- Test window controls, dialogs, menus, clipboard, file reveal, and external
  links on each desktop OS.
- Test light and dark system appearance changes.
- Test display scaling and multiple monitors.
- Test sleep, resume, minimize, restore, and shutdown with dirty editors.
- Test Wayland and X11 separately.
- Produce unsigned experiment bundles for Linux, macOS, and Windows.
- Document signing and release work without performing a production release.

Test layers:

- Rust unit tests for state transitions and core services.
- Fractal integration tests for durable behavior.
- GPUI tests for actions, focus, views, and component behavior.
- TypeScript and Lexical tests for editor behavior.
- Shared protocol contract fixtures.
- Real desktop smoke flows on Linux, macOS, and Windows.
- Performance measurements using the F1 fixtures.
- Manual accessibility checks with the platform accessibility tools.

Required desktop smoke flow:

1. Create and open a project.
2. Create a page and folder.
3. Edit title and rich content.
4. Use formatting, links, lists, and a table.
5. Save while continuing to type.
6. Open the same page in both groups.
7. Expand pages in a folder view.
8. Move and rename the page through Fractal mutations.
9. Trigger and resolve an external conflict.
10. Recover a draft after forced termination.
11. Search and navigate links and backlinks.
12. Export a page and folder.
13. Use Borealis to search and read an unsaved page.
14. Close the project and application with all writes confirmed.

Exit criteria:

- Required automated checks pass.
- The real smoke flow passes on Linux, macOS, and Windows.
- No known issue can lose confirmed editor content or bypass Fractal writes.
- The complete parity matrix has no unexplained omissions.
- Performance results are reported beside the original Tauri baseline.
- The Tauri reference still builds and can open projects written by the hybrid.
- The hybrid can open projects last written by the Tauri reference.

### H9. Run the complete-hybrid review

Goal: decide the future of the experiment without assuming that completion means
replacement.

Review questions:

- Is the Rust and GPUI ownership model materially simpler than the reference?
- Does the embedded editor behave like one component rather than a second app?
- Is everyday development easier to reason about?
- Are large documents better, equal, or worse, and why?
- Are packaging and cross-platform maintenance acceptable?
- Are accessibility, IME, clipboard, and spellcheck good enough to ship?
- Does the hybrid preserve Amanite's word-processor identity?
- Is the remaining webview an acceptable permanent design?
- Does the editor contract leave a credible route to a native GPUI editor?

Possible outcomes:

- Adopt the hybrid in a separately planned migration to `main`.
- Keep Tauri as the released application and continue the hybrid experiment.
- Retain Tauri and apply the experiment's state-model improvements there.
- Abandon the hybrid and archive the branch with its findings.

Required decision artifact:

- Record the selected outcome, evidence, unresolved risks, dependency pins,
  platform results, and any follow-up plan.
- Do not delete Tauri code, tests, or release instructions as part of this
  review.

## Performance acceptance method

Performance is a measured experiment result, not a framework claim.

For every reference and hybrid run:

- Use a release-like build with comparable diagnostics.
- Record hardware, OS, display scale, webview version, GPUI revision, and commit.
- Run each measured interaction enough times to expose warm and cold behavior.
- Report median and slow-tail results rather than one best run.
- Record memory after settling, after opening, and after sustained editing.
- Record the largest foreground-thread stall.
- Keep the generated fixture and sequence deterministic.

Initial acceptance thresholds:

- The 100,000-character document must feel immediate during typing and scrolling.
- The 1,000,000-character document must remain editable without seconds-long
  typing stalls.
- GPUI shell input must remain responsive while snapshots, drafts, saves, search,
  and Fractal operations run.
- Normal typing must produce bounded bridge messages.
- Snapshot and save work must scale with document size only when a snapshot or
  save is actually requested.
- The hybrid must not regress reference editor latency or memory by more than an
  explicitly reviewed amount.

Checkpoint 1 should replace qualitative terms with numeric thresholds after the
baseline identifies realistic values on project hardware.

## Risk register

### Webview composition

Risk: child webviews may have clipping, overlay, focus, scaling, or z-order
behavior that does not compose like ordinary GPUI elements.

Response: prove these behaviors in F3 before porting the application. Stop if a
required layout depends on an unreliable workaround.

### Multiple editor surfaces

Risk: dual groups and expanded folder pages may produce several editor views of
one logical page.

Response: select one shared-session design in F3. Never synchronize independent
models through periodic complete HTML.

### Split authority

Risk: GPUI and Lexical may both appear to own dirty content.

Response: Lexical owns the live edit model. GPUI owns revisions, accepted
snapshots, persistence state, and project identity. The protocol names every
transition.

### Webview remains the performance limit

Risk: the new shell becomes faster while very large rich documents remain bound
by Lexical and webview layout.

Response: measure honestly. The hybrid can still succeed architecturally, but it
must record the native editor as required future work if product-size documents
remain unacceptable.

### GPUI dependency churn

Risk: pre-1.0 API changes or mismatched GPUI ecosystem revisions create frequent
porting work.

Response: pin exact dependencies, isolate toolkit adaptation, update only with a
passing platform matrix, and record the cost during the experiment.

### Accessibility regression

Risk: moving controls out of HTML removes browser-provided semantics.

Response: add roles and accessible properties with each GPUI component and test
through platform accessibility tools before checkpoint 2 passes.

### Packaging gap

Risk: GPUI provides the runtime but not Tauri's complete distribution workflow.

Response: produce experiment bundles on every desktop target and write a release
gap report before recommending replacement.

### Porting accidental complexity

Risk: translating hooks and components literally recreates the current state
problems in Rust.

Response: port user-visible behavior and Fractal rules. Give each state one
owner, use typed transitions, and delete experiment abstractions that merely
forward calls.

### Uncontrolled experiment scope

Risk: the branch becomes a simultaneous redesign, editor rewrite, and feature
project that never reaches a decision.

Response: checkpoint 1 changes no product scope. Checkpoint 2 targets current
behavioral parity. A native editor and new product features remain deferred.

## Deferred work

The following work is explicitly outside both checkpoints:

- Replacing Lexical with a native GPUI rich editor.
- Changing the Fractal native document format.
- Adding browser or mobile products.
- Importing Zed's application editor or workspace crates.
- General multi-window project editing.
- A plugin or extension system.
- New word-processor features not already in the agreed Amanite and Fractal
  scope.
- Production signing, notarization, updater migration, and release-channel
  cutover.
- Deleting the Tauri application.

## Future native editor seam

The experiment should leave room for a later native editor with a host-facing
contract equivalent to:

```rust
trait DocumentEditor {
    fn load(&mut self, document: EditableDocument);
    fn revision(&self) -> EditorRevision;
    fn request_snapshot(&mut self, request: SnapshotRequest);
    fn set_read_only(&mut self, reason: Option<ReadOnlyReason>);
    fn update_known_pages(&mut self, pages: KnownPages);
    fn focus(&mut self);
}
```

The real contract will need asynchronous replies and events. This sketch only
defines the separation. Workspace code must depend on document meaning, revision
identity, and editor events rather than DOM or Lexical details.

A native editor can later change ownership to:

```text
Rust DocumentModel
  |
  +-> GPUI paints visible blocks
  +-> outline and counts update incrementally
  +-> Fractal HTML is serialized for drafts and saves
```

That later project should replace the web editor behind the established
contract. It should not require another workspace rewrite.
