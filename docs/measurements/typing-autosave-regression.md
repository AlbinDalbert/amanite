# Typing and autosave regression investigation

## Reproduction

The ordinary desktop smoke suite passed on `dca7301`. A new sustained-typing
scenario reproduced the reported recovery prompt on a newly opened small file.
It opens existing native documents from the project overview and types through
multiple autosave and disk-poll intervals.

Baseline evidence:
`artifacts/tauri-webdriver/2026-09-15T18-30-14-684Z/typing-regression.json`.
The prompt interrupted typing after `Testing ` and reported that the page had
changed since the draft was created, despite there being no external writer.

Fixing recovery re-entry alone did not fix the larger document. The next desktop
run recorded a stale HTML snapshot being imported after a newer snapshot had
already been exported. Later recovery exports contained only part of the document.
Evidence:
`artifacts/tauri-webdriver/2026-09-15T18-32-13-140Z/typing-regression.json`.

## Causes and changes

- Project snapshot updates could trigger startup draft recovery for an already
  open page. Recovery could then install an old buffer over live typing. Startup
  recovery now runs only on project entry. Pending draft reads also check that
  the buffer has not changed before installing their result.
- The HTML bridge used string equality with its latest export to decide whether
  incoming HTML should replace the editor. A delayed earlier snapshot failed that
  comparison. Shared editors now accept replacement HTML only when the buffer's
  source incarnation advances. Routine snapshot echoes cannot re-import content.
  Snapshot requests also cannot export a partially imported document.
- `7f913b4` added a full HTML parse to each document-tab render, and `9ce5f12`
  added parsing to buffer construction while the workspace still constructed an
  initial buffer every render. Both commits are within `8fd3318..8c31cd1`.
  Tabs now use the buffer's existing body HTML, and initial buffer construction
  runs only in the state initializer. Compatibility inspection also runs on
  source replacement rather than on each trusted rich-editor snapshot.
- A disk poll could overlap a section save. Section hashes advanced while the
  whole-source recovery hash stayed unchanged for newer pending edits. The poll
  compared against its old section hashes and reported a false conflict. It now
  discards results when the section baseline or document incarnation has changed.
  Pending, unexported rich edits also participate in section conflict detection.
- Typing and recovery snapshots cleared the error text of a genuine conflict,
  hiding its Reload/Replace controls until the next poll. The conflict message
  now remains visible until resolution.
- The later recovery-scheduling revisions introduced an autosave deadline that
  remained expired after a save. New save cycles now reset that deadline.
- Recovery's 180 ms idle delay exported the whole document between ordinary
  keystrokes. It now waits 500 ms. During continuous typing it requests a
  checkpoint after 1,500 ms, leaving 500 ms for export and storage before the
  two-second confirmed-recovery target.
  Autosave performs one save pass per scheduled cycle rather than immediately
  draining every edit made during a slow write. Explicit saves and close barriers
  still drain pending revisions, including when they join an in-flight autosave.

These changes preserve native Fractal section writes and their expected hashes.
Actual external edits still produce a conflict requiring the user's decision.

## Checks

Regression tests cover delayed recovery reads, save/rename snapshot publication,
HTML snapshot echoes versus explicit reloads, obsolete poll results, autosave
cycle deadlines, and avoiding full HTML parsing on revision publication.

Desktop command:

```sh
pnpm run tauri:webdriver:smoke -- --typing-regression
```

The desktop scenario asserts exact editor text, persisted text, no recovery
prompt or conflict banner, and no HTML re-import while typing. Timing evidence
comes from the debug WebDriver build and does not establish production latency
for every document size or markup structure.
