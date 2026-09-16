# Document runtime replacement P0 audit

Captured on 2026-09-16 before wiring the new runtime into the workspace.
The audit used the Fractal checkout pinned by `src-tauri/Cargo.toml` at
`9f947c7` and the current Amanite source tree.

## Fractal operation contract

The pinned Fractal API provides the boundaries the replacement needs:

- `Project::source(path)` returns the exact native HTML source.
- `Project::native_document_parts(path)` returns the title, content, managed
  style, and user metadata sections with separate hashes, plus the exact source
  hash.
- `set_page_content`, `set_page_style`, and `set_page_metadata` each require
  the hash for the section being changed.
- `set_page_title_if_unchanged` checks a title hash, changes the title, derives
  the native filename, rewrites native links, and updates folder order in one
  recoverable transaction.
- `move_page` rewrites the moved document and every page whose internal links
  target it. `set_folder_title` and `move_folder` can rewrite every native page
  in a folder subtree and pages that reference that subtree.
- `recreate_page_from_source` parses a complete native source into Fractal's
  `NativePageDraft` and refuses to overwrite a path that has reappeared.
- Mutation receipts report created, updated, moved, and deleted project entries,
  optional before and after hashes, and cleanup warnings. A receipt does not
  contain a full project snapshot by itself.

Amanite's Rust adapter runs these commands through `ProjectSessionStore`. A
cached page read uses the existing Fractal handle. Project open and explicit
refresh reopen the native project. Mutations use a per-project mutex, preserve
Fractal's operation order, and return a compact catalog snapshot together with
the receipt and base catalog version. The adapter maps
`mutation_committed`, `indeterminate`, and `recovery_required` without treating
them as ordinary conflicts.

The title rule is the important structural finding. A title keystroke cannot
call Fractal. Title editing stays local in the document session. A later title
commit needs the same bounded barrier as other path and link rewrites.

## Current ownership audit

The current implementation still has several live content authorities:

| Area | Current responsibility | Replacement disposition |
| --- | --- | --- |
| `useWorkspaceDocuments` | Owns `DocumentBuffer` source, body HTML, revisions, dirty state, load state, and live model publication | Thin UI binding around the registry and persistence coordinator |
| `documentBuffers` | Parses native source into editable fields and stores native edits beside live body/source fields | Remove as live document authority; retain section data only in persistence |
| `sharedDocumentEditor` | Creates one Lexical editor per view, copies state between peers, shares history, and keeps a mirror HTML value | Replace with one Lexical editor owned by `DocumentSession` |
| `HtmlBridgePlugin` | Imports when props change, registers a mounted flush controller, exports HTML on snapshot, and calls back into workspace source state | Explicit session initialization and read-only capture |
| `documentPersistence` | Flushes mounted editors, serializes source, calls section writes, and merges returned project content | Persistence coordinator with captured revisions and section acknowledgements |
| `useDocumentDrafts` | Observes React buffers and schedules draft work | Coordinator-owned recovery scheduling |
| `useDocumentLoading` and `useProjectFilePolling` | Install content from loads, refreshes, polls, and recovery decisions | Explicit open/reload commands and ordered external observation |
| `EditorGroupTabPanel` and `FolderView` | Mount a document editor for each group or inline folder location | Store document references and focus the existing owner |

The current editor mounting behavior matters. Hidden tab panels remain mounted,
and each location passes a different `viewId` to `useSharedDocumentEditor`.
Folder editing does the same for inline cards. `HtmlBridgePlugin` registers
flush control from the mounted view, so save and recovery currently depend on a
view being attached.

## Fixture baseline

Command:

```sh
pnpm run dataflow:benchmark
```

Environment: Linux x64, Node `v26.8.2`. The full machine-readable report and
generated fixture set are local ignored artifacts at:
`artifacts/document-dataflow/baseline.json` and
`artifacts/document-dataflow/fixtures/fixture-manifest.json`.

The matrix contains five document structures at 100,000, 1,000,000, and
5,000,000 visible characters, three native-integrity cases, and a 48-page
project. The benchmark below measures the old synchronous HTML operations in
JSDOM. It is a baseline, not a claim about the new runtime or the final desktop
targets.

| Structure | 100k parse / reconstruct | 1m parse / reconstruct | 5m parse / reconstruct |
| --- | ---: | ---: | ---: |
| Many short paragraphs | 122 / 81 ms | 673 / 692 ms | 3,093 / 3,454 ms |
| Huge paragraph | 50 / 56 ms | 561 / 536 ms | 2,386 / 2,408 ms |
| Nested lists | 125 / 129 ms | 1,249 / 1,260 ms | 6,007 / 6,749 ms |
| Large table | 142 / 126 ms | 1,292 / 1,238 ms | 5,892 / 6,243 ms |
| Dense links | 214 / 243 ms | 1,849 / 2,621 ms | 10,494 / 12,573 ms |

The benchmark still reports the complete matrix in the JSON artifact. It does
not measure Lexical input latency, native Fractal writes, or desktop recovery.
Those remain later acceptance work.

## P0 decisions

No ownership decision is left implicit for the first implementation slice:

- `DocumentSession` owns the Lexical editor, title, revision, replacement
  generation, and history lifetime.
- `DocumentRegistry` owns the path lookup and project-session scope. A path is
  an address, not a document identity.
- A session capture copies identity, path, title, revision, and immutable
  `EditorState`. It does not serialize HTML or notify workspace state.
- Path renames update the existing session in place. A new project generation
  creates a new registry and cannot reuse replies from the previous one.
- Only the session constructor and `replaceBodyHtml` perform content import.
  The registry has no prop or snapshot installation path.

The new registry/session is intentionally not wired into the old workspace
hook yet. That keeps this first change reviewable. The old runtime remains the
active UI path until the next bounded cutover work removes it.

