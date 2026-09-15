# R0 baseline evidence

R0 adds one event vocabulary for the revisit. The frontend records document
imports, complete model scans, explicit HTML exports, recovery requests and
confirmations, and every Fractal IPC request and response. Records include the
document, revision, request ID, byte count, duration, and outcome when those
fields apply.

The real desktop smoke command writes `dataflow-events-before-termination.json`
and `dataflow-events-after-restart.json` beside its logs and screenshots. The
files also record the build profile, browser user agent, reported platform, CPU
concurrency, and display backend when it is detectable.
Use a clean full build before a measured run:

```sh
pnpm run dataflow:fixtures
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
```

The existing JSDOM command remains a parser microbenchmark:

```sh
pnpm run dataflow:benchmark
```

It does not count as editor latency evidence. Ordinary interaction results need
at least 20 samples. The 5m fixtures may use five samples because each complete
parse can take several seconds and retains substantial DOM memory. Reports must
show the sample count and must not describe either policy as p95 evidence when
fewer than 20 samples completed.

## Acceptance map

| Criterion | Evidence source | R0 state |
| --- | --- | --- |
| Cold editable paint | `editor.import` duration after `fractal_read_page` | Instrumented, baseline run pending |
| Warm activation | WebDriver timing around existing tab activation | Unverified |
| Input-to-paint and post-pause stalls | WebDriver event-to-animation-frame samples | Unverified |
| Ordinary-transaction exports | `editor.full-export` correlated to snapshot requests | Instrumented |
| Recovery completion lag | `draft.request` to `draft.confirmed` | Instrumented |
| Snapshot identity and revision | `snapshot.request` request ID, document, revision | Instrumented |
| Fractal operation time and bytes | `ipc.*` duration and paired response bytes | Instrumented |
| Process and webview memory | OS process sampling during desktop run | Unverified |

The baseline desktop smoke from D8 remains the unchanged behavioral reference.
An R0 full-build smoke run passed on 2026-09-15 under Linux X11 with WebKit
60.5, 8 reported CPUs, and the debug WebDriver profile. The ignored artifacts
are under `artifacts/tauri-webdriver/2026-09-15T15-43-19-575Z/`. The first
instrumented run wrote the final process only, which exposed the need for the
two phase files now produced by the harness. It did not collect 20-sample
latency distributions. Windows, Wayland, macOS, real IME input, and
process-memory evidence remain unverified.
