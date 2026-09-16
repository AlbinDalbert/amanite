# Architecture

This document describes the pre-replacement implementation. The target design,
implementation ledger, and acceptance gates are in the
[document runtime replacement plan](document-runtime-replacement-plan.md).
Rewrite this description when the replacement's final gate is complete.

Fractal owns durable project state, native document semantics, paths, links,
transactions, and exports. Amanite is the Tauri desktop client: React owns
workspace presentation and TypeScript owns live Lexical document sessions.

```text
React shell
-> useFractalSession (project identity, status, receipts)
-> useWorkspaceDocuments (live sessions, queries, scoped persistence)
-> fractalClient
-> asynchronous Tauri commands
-> ProjectSessionStore (retained Fractal projects and freshness)
-> fractal::Project
-> native project files and native recovery drafts
```

## Project and document ownership

`useFractalSession` owns the active project snapshot, project generation,
catalog status, inspection, confirmations, and command receipts. It does not
own editable page state. `ProjectSessionStore` retains one
`fractal::Project` per canonical project root in Rust, serializes operations
for that project with a per-project mutex, and labels publications as cached,
refreshed, or mutated. The registry does not serialize work for unrelated open
projects. Refresh opens occur while holding the project mutex, unchanged
refreshes keep their catalog version, and backend session generations remain
stable across refreshes.
Fractal-heavy commands run in Tauri blocking workers so they do not occupy the
runtime that serves editor input. An explicit refresh remains available when
fresh disk state is required.

`useWorkspaceDocuments` is the owner of open document sessions. Each logical
document has one in-memory buffer with a stable document ID, mutable project
path, accepted native source and section hashes, editable title/body state,
Lexical model revisions, snapshots, pending native edits, save and recovery
revisions, hashes, and conflict state. Both editor groups and folder inline
editors attach to that session. Every visible view owns a Lexical controller
and its selection/scroll attachment, while the document session owns the
authoritative `EditorState`, revision, derived model, and shared undo history.
Input ownership can move between views without flattening another visible view.

Typing reports a revision and updates dirty top-level blocks in the
session-owned derived model. Counts and outline reuse that model; complete text
is materialized lazily and cached by revision. Complete native-source
serialization is requested through the registered editor snapshot barrier only
for saving, recovery, export preparation, close, or another consumer that needs
serialized source. The barrier is a direct document-ID registry; there is no
global event authority. A per-document save queue preserves newer revisions,
and `savePaths` provides scoped barriers for known page sets. `saveAll` remains
for project/window close and mutations whose rewrite scope is deliberately
conservative.

## Persistence boundary

Amanite edits native `*.fractal.html` documents only. Durable project changes
go through Fractal section APIs with the expected section hashes. Title, body,
style, and metadata sections retain their untouched source until Fractal
confirms the corresponding mutation. Fractal owns path derivation, link
rewrites, atomicity, conflict detection, receipts, warnings, and committed or
uncertain outcomes.

Each mutation receipt is reconciled once across project catalog references,
document paths, tabs, history, closed tabs, buffers, drafts, and affected
queries. Unchanged catalog objects are reused. Dirty or externally missing
sessions remain recoverable until an explicit resolution permits disposal.
Uncertain outcomes trigger a best-effort project refresh while retaining local
edits and the reported outcome.

Recovery drafts contain exact native source and live in Amanite application
data outside the project. They are versioned, revision-tagged, serialized per
project, and removed only after a confirmed save or explicit discard. Recovery
tracks requested, captured, queued, confirmed, and failed revisions, retains
the earliest outstanding deadline, and retries transient failures with bounded
backoff. Drafts are not a second project or document format. Exports use a
saved, resolved path and are executed by Fractal.

## Queries and invalidation

The project catalog contains document path, title, and content hash, but no
source, saved text, or links. Full content is fetched through the explicit page
read. Saved search is a bounded backend query; live editor entries overlay its
results by path. Mutation publications carry a base catalog version and
affected metadata entries. A version gap causes an explicit full metadata
refresh.

`DocumentQueryIndex` is the shared in-memory query surface for folder search,
Quick Open, Borealis, previews, counts, bounded text reads, and live link
context. Open sessions overlay revision-tagged live models and titles on the
saved catalog. `PageTitleIndex` owns title/path lookup and derived-link
matching, so body-only changes do not rebuild title data.

The project catalog remains the saved Fractal metadata view. File polling is an
invalidation hint and compares affected content before offering reload or
replacement. A refresh never overwrites dirty content merely because a page
is absent from the refreshed catalog.

## Editor groups and folders

The workspace has left and optional right groups. Each group owns tab order,
active view, and navigation history; a tab identifies a document, folder view,
or Borealis. Warm activation keeps the document session and undo history in
memory and does not imply a disk read or HTML import. Closing one view does not
dispose a session still attached to another view.

Fractal supplies folder metadata and ordered children. Amanite routes folder
creation, title changes, reorder, deletion, page moves, and folder export
through Fractal, then applies the returned receipt scope to workspace state.

## Native document safety

Unsupported or incompatible native content remains protected with its exact
source and is not silently converted into an editable replacement. Editable
content is imported into the configured Lexical node set and serialized only
at explicit snapshot boundaries. Rendered output applies the app's safety
policy to links, media, and embedded content while preserving native sections
that Amanite does not edit.

## Current limits

- Fractal still reloads and reconstructs broad catalog state internally for
  some reads and section mutations. Retaining the project handle does not make
  those operations incremental.
- Fractal still returns broad in-memory page models internally. Amanite's IPC
  contract removes their text and links and publishes affected metadata, but
  the root folder entry necessarily grows with its child list.
- Initial Lexical import, explicit snapshot export, and a dirty root update are
  document-sized work. The repository does not claim uncollected cold-paint,
  warm-switch, input-to-paint, or process-memory distributions.
- The verified desktop matrix in this repository is Linux on the recorded
  harness machine. Windows, separate Wayland/X11 runs, and macOS hardware
  require their own evidence.
