# D8 verification

Completed on 2026-09-15 after D0 through D7 had been committed. D8 reviewed
the shipped data-flow, removed the remaining transitional frontend adapters,
repeated the D0 fixture measurement, and exercised the real Tauri desktop
harness.

## Shipped review

- The global editor-flush event path was removed. Snapshot requests now use the
  registered document controller directly, so one document cannot flush an
  unrelated editor.
- The AI workspace contract now requires `DocumentQueryIndex`. The old
  `searchProject` IPC adapter and dirty-source reparsing fallback were removed.
- Folder, Quick Open, Borealis, previews, counts, and live link context use the
  shared query surface. Receipt reconciliation remains the single path for
  mutation updates across catalog entries, buffers, tabs, history, closed tabs,
  drafts, and affected queries.
- `docs/architecture.md` now describes the native-only Fractal boundary,
  retained Rust project sessions, live document ownership, snapshot barriers,
  recovery drafts, and known limits.
- The desktop smoke flow now covers the rich-editor contract (typing,
  composition lifecycle, formatting, tables, and undo) and forced
  termination/restart recovery of a native draft.

## Verification evidence

- `pnpm exec tsc -b --pretty false`: passed.
- `pnpm test -- --runInBand`: 36 test files and 117 tests passed.
- `pnpm run build`: passed.
- `cargo test --manifest-path src-tauri/Cargo.toml`: 20 tests passed.
- `pnpm run tauri:webdriver:doctor`: passed.
- `pnpm run tauri:webdriver:smoke -- --skip-build`: passed through the real
  Tauri desktop harness under
  `artifacts/tauri-webdriver/2026-09-14T22-31-07-239Z/`.
- A final full-build `pnpm run tauri:webdriver:smoke` run is recorded under
  `artifacts/tauri-webdriver/2026-09-14T22-42-58-405Z/` after the final
  verification pass.

The desktop flow covered both editor groups, folder views, warm switching,
rename and move, external changes, page recreation, scoped saves, exports,
recovery drafts, and project reopen. Partial section-save and uncertain-outcome
behavior is covered by deterministic frontend and Rust tests. The desktop
harness does not inject a Fractal fault halfway through a live transaction, so
that specific case is not claimed as desktop fault-injection coverage.

Composition coverage uses synthetic `compositionstart`, `compositionupdate`,
and `compositionend` events in the harness. It verifies the snapshot barrier
contract, but is not a claim about every operating-system IME. The recorded
desktop matrix is Linux on the harness machine; Windows, separate Wayland/X11
runs, and macOS still need platform-specific evidence.

## D0 measurement rerun

The same deterministic fixtures were measured with:

```sh
pnpm exec node scripts/document-dataflow-benchmark.mjs artifacts/document-dataflow/d8
```

D0 is recorded in `artifacts/document-dataflow/baseline.json`; D8 is recorded
in `artifacts/document-dataflow/d8/baseline.json`. Both runs report Node
`v26.8.2`, Linux, x64, and the paired fixtures have identical byte counts,
visible-character counts, and IPC-payload proxies. D0 was generated at
`2026-09-14T19:30:53.651Z`; D8 at `2026-09-14T22:04:31.364Z`.

The table shows median milliseconds for HTML parse, visible-text query, and
source reconstruction:

| Fixture | D0 parse | D8 parse | D0 text | D8 text | D0 reconstruction | D8 reconstruction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| many-short 100k | 70.1 | 68.9 | 47.0 | 52.5 | 50.6 | 44.9 |
| dense-links 100k | 120.6 | 130.2 | 128.8 | 125.0 | 137.0 | 130.9 |
| many-short 1m | 413.7 | 401.0 | 447.5 | 463.4 | 398.6 | 418.6 |
| dense-links 1m | 1181.6 | 1177.0 | 1233.9 | 1203.5 | 1360.9 | 1273.0 |
| many-short 5m | 2163.3 | 2017.4 | 2302.1 | 2347.1 | 2106.8 | 2098.8 |
| dense-links 5m | 5874.8 | 5754.0 | 6026.4 | 6243.4 | 6897.2 | 7629.7 |

These are comparable fixture timings, not a claim that D8 made parsing or
editing faster. The spread includes normal run-to-run variation; the benchmark
does not measure cold first paint, warm activation, typing stalls, memory,
webview differences, or full Fractal operation latency.

The D0 acceptance targets remain unchanged: cold first editable paint <= 1,500
ms, warm activation <= 50 ms, typing foreground stall p95 <= 50 ms, longest
post-pause stall <= 100 ms, recovery checkpoint lag <= 2,000 ms, and zero
complete HTML exports during ordinary typing.

## Remaining limits

- Fractal still performs broad reload/reconstruction work for some reads and
  mutations; the retained project handle does not make those operations
  incremental.
- Project and mutation DTOs still use the existing full snapshot shape; the
  frontend now avoids unnecessary work but does not yet have a compact IPC
  protocol.
- Lexical import and very large paragraphs or tables remain document-sized
  work. The 5m fixtures continue to exceed interactive budgets in parts of the
  benchmark, which is recorded rather than hidden.
- Polling remains an invalidation hint, and native recovery-draft directory
  synchronization still has the D4 best-effort boundary.
