# Amanite native v2 adoption and trust plan

Status: proposed for execution

This plan moves Amanite from Fractal `1974c93` to the native-only v2 API at
Fractal `9f947c7`. It also completes the Amanite trust work identified in the
September 2026 review.

The migration is intentionally narrow. Amanite remains a desktop editor for
native Fractal projects. Fractal owns durable project files, validation,
transactions, repair, and mutation receipts. Amanite owns editor buffers, save
timing, recovery drafts, user decisions, and presentation.

## Baseline

The plan starts from Amanite `f2d7d62` and Fractal `9f947c7`.

Current Amanite results before the dependency update:

- 67 frontend tests pass across 19 files.
- The production frontend build passes.
- 9 Rust tests pass.
- Clippy fails on `items_after_test_module` and `large_enum_variant`.
- The real Tauri smoke flow passed at the time of the review.
- There is no checked-in Amanite CI workflow.

A compile check against Fractal `9f947c7` fails with 27 Rust errors. The errors
come from APIs and fields that Fractal removed, including `PageKind`, raw page
writes, iframes, head links, and the old mutation shape. This is the expected
starting point, not a Fractal regression.

Fractal `9f947c7` supplies the engine work this plan depends on:

- a native-only page catalog;
- section-level native edits with conflict hashes;
- typed mutation receipts and warnings;
- read-only project inspection;
- explicit recovery and repair;
- guarded recreation of a missing native page;
- explicit folder creation;
- safe native element, attribute, URL, and CSS validation;
- distinct `Indeterminate` and `MutationCommitted` error codes;
- single-page and ordered-folder HTML exports.

## Product and data decisions

These decisions remain fixed during this work. Changing one requires updating
this plan before changing code.

1. Amanite opens and edits native `*.fractal.html` documents only.
2. Ordinary HTML and other opaque files do not appear as pages or assets.
   Amanite never deletes, relocates, or rewrites them outside a Fractal call.
3. Native documents still use HTML as their storage representation. Amanite may
   keep exact native source in memory and in recovery drafts. It does not offer
   a generic raw HTML editor or whole-source writes to live pages.
4. Amanite does not support managed assets, images, iframes, head links,
   external import, legacy conversion, or project format v1 migration.
5. Invalid native documents remain visible. Amanite explains why rich editing
   is disabled and offers only Fractal-supported repair actions. It never
   silently strips invalid content.
6. Every durable project mutation goes through `fractal::Project`.
7. Recovery drafts live in Amanite app data, outside the project. They are
   temporary recovery records, not another project format.
8. Mutation receipts are session records. Amanite does not invent a persistent
   mutation journal that Fractal does not provide.
9. Borealis remains read-only until this plan is complete.
10. The trust release stores the AI key in memory for the current session. A
    later keychain feature may restore persistence without returning to webview
    storage.

In-project page duplication may remain as an Amanite operation. It must read a
native page, create another native page, and apply sections through Fractal.
The operation is not an importer. If one of its committed steps fails, Amanite
must report the partial duplicate and open it for inspection. It must not hide
partial success behind best-effort deletion.

## Execution rules

- Complete the work packages in order.
- Keep each work package reviewable and leave the repository passing its stated
  exit checks.
- Do not mix editor features into this migration.
- Preserve unrelated user changes in the worktree.
- Use the real Tauri WebDriver app for desktop behavior.
- Add regression tests with each behavior change, not in one cleanup commit at
  the end.
- Once CI exists, do not merge a later work package while required checks fail.
- Update the progress table when a work package lands.

## Progress

| ID | Work package | Status | Depends on |
| --- | --- | --- | --- |
| A1 | Remove non-native editor behavior | Complete | None |
| A2 | Adopt Fractal `9f947c7` and rebuild the adapter contract | Complete | A1 |
| A3 | Establish clean checks, CI, and backend module ownership | Complete | A2 |
| A4 | Reconcile application state from mutation receipts | Complete | A2, A3 |
| A5 | Add project inspection, recovery, and explicit repair | Complete | A4 |
| A6 | Add durable drafts and missing-page recreation | Complete | A4, A5 |
| A7 | Add the project health panel | Complete | A5, A6 |
| A8 | Harden credentials, CSP, and link handling | Complete | A2 |
| A9 | Complete desktop reliability and release verification | Complete | A1 through A8 |

## Checkpoint 1: native-only Amanite

Checkpoint 1 ends when Amanite builds against Fractal `9f947c7`, edits native
pages, and contains no raw page, asset, iframe, or head-link behavior.

### A1. Remove non-native editor behavior

Goal: remove product behavior that conflicts with the new Fractal contract
while the old dependency can still compile the backend.

Changes:

- Delete the raw HTML editor and rendered raw-page preview.
- Make the document buffer native-only. Remove `kind` branches and raw save
  logic.
- Remove raw-page sections from folder views, export dialogs, search prompts,
  and tests.
- Delete image and iframe Lexical nodes, toolbar controls, paste handlers, drop
  handlers, inspector sections, styles, and tests.
- Remove iframe and embed counts from the inspector.
- Remove head links from native parts, editable sections, polling, save order,
  duplication, and tests.
- Remove the unused native import prop and user flow.
- Keep duplicate-page behavior behind a native-only interface. Do not call it
  import in code or UI.
- Separate Fractal validity from rich-editor compatibility. Fractal decides
  whether a document is valid. Amanite decides whether Lexical can preserve a
  valid document without loss.
- Update the compatibility guard so unsupported content disables rich editing
  before Lexical transforms the source.
- Keep exact source on the buffer for reconstruction and recovery.

Tests:

- A normal native document loads, edits, and saves.
- No raw-page or media controls render.
- An invalid native page remains visible and unchanged.
- A Fractal-valid document that Lexical cannot preserve receives an accurate
  compatibility message.
- Folder views and export selection contain native pages only.

Exit criteria:

- `rg` finds no production references to `PageKind`, raw page writes,
  `RawHtmlEditor`, `RenderedHtmlPage`, `Iframe`, `ImageNode`, head links, or
  "Other HTML".
- Frontend tests and the production build pass against the old locked Fractal
  revision.

Suggested commit:

```text
refactor: remove non-native editing behavior
```

### A2. Adopt Fractal `9f947c7` and rebuild the adapter contract

Goal: compile and run against the completed native-only Fractal API.

Changes:

- Pin the exact Fractal revision in `src-tauri/Cargo.toml` and update
  `src-tauri/Cargo.lock`.
- Update `AGENTS.md` to remove raw-page persistence instructions and record the
  native-only boundary.
- Remove backend DTO fields and commands for page kinds, raw writes, iframes,
  iframe backlinks, and head links.
- Make every loaded page native. Keep native parts optional because an invalid
  native document may not yield editable sections.
- Change link targets to Fractal's `resolved` and `broken` variants.
- Handle external links separately from the native link index. Permit only the
  URL schemes accepted by Fractal and route them through a tested desktop-safe
  action.
- Replace direct filesystem folder creation with
  `Project::create_folder(parent, title)`. Never create missing ancestors.
- Change page movement UI to select a destination folder while preserving the
  title-derived filename. Fractal now rejects arbitrary destination names.
- Update page creation and duplication for the title-derived path rule.
- Remove the old import command. If duplication stays, give it a dedicated
  Amanite command and return every committed step.
- Preserve `FractalErrorCode` at the Tauri boundary instead of converting every
  failure to a string.
- Add TypeScript types for all current Fractal error codes, including
  `indeterminate` and `mutation_committed`.
- Add serialization contract tests for the Rust DTO and TypeScript wire shape.

Error policy:

- `conflict` marks the affected buffer conflicted and keeps the draft.
- `recovery_required` blocks further mutations and opens the recovery flow.
- `indeterminate` triggers inspection. Amanite does not retry automatically.
- `mutation_committed` tells the user that bytes changed, refreshes from disk,
  and does not retry.
- `unsupported_version` keeps the project closed and explains that Amanite has
  no v1 migration.
- Ordinary validation and input errors remain actionable operation errors.

Tests:

- Rust DTO serialization matches the TypeScript contract.
- Folder creation calls Fractal once and requires an existing parent.
- Moving a page preserves its filename and changes only its parent folder.
- External safe links and broken native links take different paths.
- Each special Fractal error code produces the intended application status.

Exit criteria:

- Amanite compiles against Fractal `9f947c7` with no compatibility shim.
- Frontend tests, frontend build, Rust tests, formatting, and Clippy pass.
- A real Tauri smoke run covers project creation, page creation, editing,
  saving, folder creation, movement, and export.

Suggested commit:

```text
refactor: adopt native-only Fractal v2
```

### A3. Establish clean checks, CI, and backend module ownership

Goal: make every later work package run against enforced checks and keep new
recovery code out of the existing `lib.rs` catch-all.

Changes:

- Fix the existing Clippy failures without adding allow attributes.
- Reduce `src-tauri/src/lib.rs` to application setup and command registration.
- Move Fractal DTOs, snapshots, and command wrappers into a Fractal adapter
  module.
- Move project catalog scanning into a catalog module.
- Move AI HTTP code into an AI adapter module.
- Keep file-manager integration in a small platform module if it does not fit
  the catalog module.
- Add a checked-in CI workflow with pinned action revisions.
- Run `pnpm install --frozen-lockfile`, frontend tests, frontend build, Rust
  formatting, Rust tests, and Clippy.
- Use least-privilege workflow permissions.
- Require locked dependency builds in CI.

Do not build a command framework or generic service layer. The modules should
remain thin adapters over explicit operations.

Tests:

- Existing Rust adapter tests move with their owning modules and keep passing.
- A corrupt project still does not hide healthy catalog entries.
- Application setup registers every expected command once.

Exit criteria:

- The full fast check suite passes locally and in CI.
- `src-tauri/src/lib.rs` no longer owns catalog policy or AI request logic.
- No module exists only to forward calls through another empty layer.

Suggested commits:

```text
refactor: split native adapters by ownership
ci: enforce Amanite checks
```

## Checkpoint 2: inspectable trust behavior

Checkpoint 2 ends when Amanite can explain project state, apply mutation
receipts, recover interrupted transactions, preserve drafts durably, and
recreate a deleted open page.

### A4. Reconcile application state from mutation receipts

Goal: stop guessing what Fractal changed.

Wire contract:

```ts
type FractalMutationResult = {
  project: FractalProject;
  receipt: FractalMutationReceipt;
};
```

Conditional section writes return either a saved result containing the project
and receipt, or a typed conflict. Repair and recovery use their own report
types because they can contain warnings and partial failures.

Changes:

- Mirror `MutationKind`, `ProjectChange`, `ProjectEntryKind`,
  `OperationWarning`, and `MutationReceipt` in the TypeScript contract.
- Convert project-relative receipt paths such as `pages/book/one.fractal.html`
  to Amanite page paths in one tested helper.
- Derive newly created pages from a created file entry. Never use the first
  receipt entry.
- Apply moved file mappings to editor buffers, tabs, active paths, history,
  closed-tab history, loading state, and drafts.
- Apply moved directory mappings to folder tabs and folder navigation.
- Remove state for deleted entries only after the receipt says they were
  deleted.
- Refresh clean open buffers when a receipt reports a rewrite caused by link or
  folder movement.
- Mark a dirty rewritten buffer as conflicted. Do not replace its local source.
- Display receipt warnings, especially `cleanup_pending`.
- Keep the most recent receipt in session state for the health panel.

Reconciliation order:

1. Parse and validate the receipt.
2. Build page and folder path mappings.
3. Move buffer and navigation identities.
4. Apply deletions.
5. Publish the returned project snapshot.
6. Reload clean changed buffers.
7. Mark dirty changed buffers as conflicts.
8. Record warnings and the last receipt.

Tests:

- A title edit renames the active page and every open copy of its tab.
- A page move accepts an omitted suffix and a leading `pages/` at the backend
  boundary, then uses the normalized receipt path in the UI.
- A folder title change remaps nested page buffers and folder tabs.
- Link rewrites reload clean pages and protect dirty pages.
- A no-op receipt leaves application state unchanged.
- A cleanup warning remains visible until dismissed.

Exit criteria:

- No mutation flow searches snapshots by title to discover a path.
- No mutation flow uses requested user input as the authoritative resulting
  path.
- Receipt reconciliation has focused unit tests independent of React.
- The Tauri smoke flow covers page title rename, page move, and folder rename
  with open tabs in both editor groups.

Suggested commit:

```text
feat: reconcile workspace state from Fractal receipts
```

### A5. Add project inspection, recovery, and explicit repair

Goal: make startup and project opening reflect Fractal's non-writing lifecycle.

Changes:

- Add Tauri commands for `Project::inspect`, `Project::recover`, and
  `Project::repair`.
- Include inspection state with project catalog entries. Use the directory name
  when a blocked project cannot supply a manifest name.
- Inspect before opening a project.
- Show distinct start-screen states for healthy, openable with issues,
  recovery required, malformed recovery data, unsupported version, and invalid
  project.
- Allow an openable project with validation issues to open in protected mode.
- Require a user action before recovery or repair.
- Show proposed repairs before applying them.
- Apply repair and recovery reports through the same path-mapping logic used
  for mutation receipts.
- Keep malformed recovery data intact and explain that automatic recovery is
  unavailable.
- Offer a fresh inspection after any failed or suspicious operation.

Tests:

- Inspection does not change project files.
- A pending transaction blocks open and offers recovery.
- A committed cleanup-pending transaction remains openable and can be cleaned.
- Proposed title and folder-order repairs appear before mutation.
- Repair reports partial progress and typed failures.
- Format v1 remains visible as unsupported and cannot be opened.

Exit criteria:

- Opening a project never performs a hidden repair.
- Recovery-required projects remain discoverable in the catalog.
- Every recovery or repair result lists what changed or why it stopped.
- The real Tauri app covers recovery-required startup and explicit repair.

Suggested commit:

```text
feat: add inspected project open and recovery
```

### A6. Add durable drafts and missing-page recreation

Goal: make unsaved editor recovery observable and independent of webview
storage.

Draft record:

```text
version
project root
page path
complete native source
base source hash
updated timestamp
```

Changes:

- Store drafts under Amanite's native app-data directory, never inside a
  Fractal project.
- Use safe digest-based filenames and keep the original root and page path
  inside the record.
- Write a temporary file, flush it, and atomically replace the previous draft.
- Add commands to list, read, write, move, and delete drafts.
- Return draft-storage failures to the frontend and keep a visible unhealthy
  state until a later write succeeds.
- Convert draft operations to asynchronous frontend calls with queued writes
  per page. A stale completion must not delete or replace a newer draft.
- Migrate valid `amanite.page-draft.v1` localStorage records once. Delete an old
  record only after its native replacement commits.
- Move draft identities when a mutation receipt moves a page.
- Distinguish a changed file from a missing file during polling.
- Show `Reload disk` and `Replace disk` only for a changed existing page.
- Show `Recreate page` for a missing page.
- Derive the recreation destination from the draft title and current parent.
  This handles an unsaved title edit without violating title-derived paths.
- Call Fractal's guarded recreation operation. If the file reappears, surface a
  conflict and preserve the draft.
- Clear the draft only after the recreation receipt and refreshed source agree.
- Keep an invalid old draft available for manual recovery. Do not force it into
  a project or silently discard it.

Tests:

- Draft writes survive a webview restart.
- A failed draft write appears in application health.
- Rapid edits cannot let an older write replace a newer draft.
- A clean save deletes only the matching draft generation.
- Page and folder moves relocate draft identities through receipts.
- A missing page can be recreated from its buffer.
- A reappeared page cannot be overwritten by recreation.
- A draft with an unsaved title recreates at the title-derived path.
- Legacy localStorage migration is one-way and lossless.

Exit criteria:

- Production recovery no longer depends on localStorage.
- The missing-file action succeeds or returns a precise conflict.
- The real Tauri smoke test creates, discovers, accepts, rejects, and clears a
  native recovery draft.
- The smoke test recreates a deleted open page.

Suggested commit:

```text
feat: add durable native draft recovery
```

### A7. Add the project health panel

Goal: answer the user's question, "Are my project files safe right now?"

The panel combines Fractal facts with Amanite session facts.

Fractal facts:

- project format version;
- openable and healthy state;
- validation issues;
- pending or malformed recovery transactions;
- cleanup-pending transactions;
- proposed repairs.

Amanite facts:

- pending recovery drafts;
- draft-storage health;
- dirty and conflicted buffers;
- last successful save time in this session;
- most recent mutation receipt and warnings in this session.

Changes:

- Add a health entry point that is visible without waiting for an error.
- Add a one-click fresh inspection.
- Link validation issues to the affected native page when possible.
- Put recover and repair actions beside their reports.
- Label session-only facts as session-only.
- Avoid a generic green badge when inspection could not complete.
- Do not add persistent mutation history or a backup system in this work
  package.

Tests:

- Healthy, invalid, recovery-required, cleanup-pending, draft-failure, dirty,
  and conflict states render distinctly.
- Refresh replaces stale inspection data.
- Receipt warnings appear in both the operation notice and health panel.
- Project actions are disabled while recovery state is unresolved.

Exit criteria:

- Every Fractal health issue has a visible representation.
- Draft failures and conflicts cannot coexist with a "healthy" summary.
- The panel can trigger inspection, recovery, and repair without reopening the
  application.

Suggested commit:

```text
feat: add project health and recovery status
```

## Checkpoint 3: hardened release

Checkpoint 3 ends when the desktop boundary is hardened and the complete
reliability matrix passes in the real app.

### A8. Harden credentials, CSP, and link handling

Goal: remove paid credentials from script-readable persistence and restrict the
webview to the resources Amanite actually uses.

Changes:

- Remove `apiKey` from persisted AI settings and migrate old settings by
  discarding the persisted key while retaining endpoint and model.
- Keep the key in React memory for the current application session.
- Make the settings screen state clearly that the key is session-only.
- Add a tested Tauri CSP for local scripts, styles, IPC, and other resources the
  application needs.
- Keep AI network requests in the Rust backend so user-configured endpoints do
  not require broad webview network access.
- Review every remaining `window.open`, URL parser, and navigation path.
- Open only explicitly allowed external schemes. Native links continue through
  Fractal's resolved link data.
- Confirm that invalid active attributes, unsafe URLs, and resource-loading CSS
  never enter the rich editor.
- Keep exported HTML handling in Fractal. Amanite displays Fractal validation
  failures instead of weakening them.

Tests:

- Reloading the app does not restore an API key.
- Persisted settings contain no credential.
- CSP blocks an injected inline script and unexpected remote resource.
- Normal Tauri commands, editor styles, exports, and AI backend calls still
  work under CSP.
- Safe external links and rejected schemes have explicit tests.

Exit criteria:

- No production localStorage value contains an AI key or recovery draft.
- CSP is non-null in production configuration.
- Borealis remains read-only.
- The real desktop smoke flow passes with CSP enabled.

Suggested commit:

```text
fix: harden desktop credentials and content policy
```

### A9. Complete desktop reliability and release verification

Goal: prove the migrated application through the same interface users run.

Reliability matrix:

| Area | Required scenario |
| --- | --- |
| Native editing | Create, edit, save, reopen, and export |
| Save queue | Edit again while a save is in flight |
| Conflict | Same-section external edit becomes a visible conflict |
| Merge | Different-section external edit merges safely |
| Receipts | Page title, page move, and folder title update every open view |
| Missing file | Deleted open page can be recreated without overwriting a reappeared file |
| Drafts | Draft survives restart, can be declined, and clears after a confirmed save |
| Project recovery | Interrupted transaction blocks open, reports affected paths, and recovers |
| Repair | Proposed repair is reviewed before it changes files |
| Opaque content | Opaque files stay hidden and make unsafe folder operations fail cleanly |
| Invalid native source | Page remains visible, protected, and byte-for-byte unchanged |
| Security | CSP is active and the API key is absent after restart |
| Shutdown | Desktop process exits without allocator corruption output |
| Packaging | Declared AppImage bundle builds and opens |

Changes:

- Extend the WebDriver script instead of adding browser mock coverage for these
  scenarios.
- Replace direct localStorage draft injection with the native draft command.
- Add focused fixtures for healthy v2, invalid native, repairable v2,
  recovery-required, opaque-descendant, and unsupported v1 projects.
- Keep the unsupported v1 fixture only to test rejection. Do not promise
  migration compatibility.
- Reproduce and fix the `free(): corrupted unsorted chunks` shutdown message.
- Run the full desktop smoke flow on a clean build, then rerun with
  `--skip-build` to catch state leakage.
- Build and launch the declared AppImage output.
- Update README documentation and screenshots that mention removed HTML or
  media behavior.
- Replace or mark the old root `ROAST.md` as historical. It must not remain the
  active roadmap after this plan lands.
- Record the exact Amanite and Fractal revisions in the release notes.

Final verification:

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml --all-features
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
pnpm run tauri:webdriver:smoke -- --skip-build
pnpm run tauri:build:appimage
```

Exit criteria:

- Every row in the reliability matrix passes.
- CI is green from a clean checkout.
- The desktop process exits cleanly after repeated smoke runs.
- No raw page, asset, iframe, head-link, import, or v1 migration behavior
  remains.
- Amanite displays the exact Fractal revision used by the build or includes it
  in an accessible diagnostics report.

Suggested commit:

```text
test: verify native project reliability
```

## Deferred work

The following work does not belong in this plan:

- Borealis write tools;
- imports or legacy conversion;
- managed assets or attachments;
- raw HTML pages;
- a persistent mutation journal;
- project backup and restore;
- format v1 migration;
- Windows or macOS packaging until those targets are explicitly supported;
- new editor tools unrelated to the native v2 migration.

These can be reconsidered after the trust release. None should delay the
native-only cutover, receipt handling, recovery, durable drafts, CSP, or CI.
