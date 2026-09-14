# D4 verification

Completed on 2026-09-14 after D0 through D3 had been committed.

## Structural result

- Recovery drafts and autosave are scheduled per document identity, with an
  idle delay and a maximum lag of two seconds. A newer revision releases a
  failed checkpoint so a transient failure does not loop forever on the same
  revision.
- Draft records carry a monotonic revision. Older queued writes are
  superseded, while project-level draft writes, moves, and deletes are
  serialized so cleanup cannot overtake a newer checkpoint.
- Save and recovery requests share the registered editor snapshot barrier.
  A snapshot is confirmed only after the native draft write completes, and
  each document keeps its own draft error.
- Drafts remain native `*.fractal.html` source outside the project. Legacy
  records without revision metadata read as revision zero.

## Durability boundary

Draft writes use a temporary file, flush the file contents before rename, and
on Unix best-effort flush the draft directory after rename. This protects
against the normal process-crash window after a completed write. It does not
claim power-loss durability across every filesystem, and forced-termination
coverage remains part of D8.

## Verification evidence

- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm test -- --runInBand`: 34 test files and 104 tests passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: passed with 18 tests.
- `pnpm run tauri:webdriver:smoke`: passed through the real Tauri desktop
  harness. The run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T20-55-07-549Z/`.

The regression test covers explicit revision fallback without a pending body
state and verifies that editor cleanup does not re-export a saved buffer. The
draft queue tests cover obsolete writes and queued cleanup. The desktop flow
covers recovery, save, move, export, missing-page recreation, and reopen.

## Remaining limits

The frontend queue is deliberately conservative and serializes draft
operations per project, not concurrently per page. Draft storage reports
completion to the UI, but a power loss can still leave the last rename or
directory entry unsynced on filesystems without the required guarantees.
Forced-termination recovery and comparable D0 timing measurements remain for
D8.
