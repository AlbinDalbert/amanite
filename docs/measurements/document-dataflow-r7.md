# R7 local acceptance evidence

R7's local Linux pass completed on 2026-09-15. It found three desktop-only
snapshot bugs before the final passing run. A reused snapshot retained the old
request ID, and a recovered buffer could request a snapshot before its editor
controller mounted. The shared editor also started a recovered document at
revision zero instead of the buffer's restored revision. The fixes preserve the
new request identity, wait up to one second for a controller that is mounting,
and initialize a new shared session from the buffer revision and incarnation.
Those fixes are commit `33bbb1f`.

The first passing smoke exposed one more scheduling error. A successful
checkpoint retained its original start time while later revisions arrived, and
stale React props could briefly queue the just-confirmed revision again. That
made two reported lags exceed three seconds and wrote revision 11 twice. Commit
`3d319df` resets the request origin after confirmation and treats the locally
confirmed revision as authoritative while the callback state catches up.

The final real-desktop run passed with a fresh Tauri WebDriver build. It covered
both editor groups, folder editing, save and reopen, move and recreation,
composition contract events, and recovery after forced process termination:

```sh
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
```

The run used the `debug-webdriver` profile on Linux x86_64 with 8 reported CPUs
and WebKit 60.5. The user agent reports X11, while the explicit display-backend
field is `unreported`. Screenshots, logs, exported content, and the two event
files are under
`artifacts/tauri-webdriver/2026-09-15T17-56-36-347Z/`.

The pre-termination file contains 301 events. Fourteen successful editor
imports took 1 to 15 ms for the small smoke documents. Eight requested complete
exports took 0 to 2 ms. Six page-read responses were 2,588 to 2,781 bytes, and
five content-mutation responses were 3,635 to 4,067 bytes. The restarted
process recorded 39 events, including a 10 ms import and the successful save of
the recovered revision. These samples verify the smoke path, but they are not
the required 20-sample cold-paint, warm-activation, typing-latency, or memory
distributions.

## Recovery result

The seven confirmed checkpoint lags were 482, 391, 204, 208, 199, 197, and 189
ms. All writes completed, including the draft restored after forced
termination. No confirmation exceeded the 2,000 ms target, and no revision was
written twice. This passes the target for the local smoke sequence. It is not a
cross-platform or sustained-load distribution.

The run proves process recovery after a confirmed Linux draft write. It does
not prove interruption at every temporary-write, sync, rename, directory-sync,
and cleanup boundary. Windows replacement and controlled power-loss behavior
also remain unverified.

## Repository checks

The final implementation passed:

```sh
pnpm run dataflow:fixtures
pnpm run dataflow:benchmark
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
```

Fixture generation produced the 18 large-document fixtures and the 48-page
project. All 128 frontend tests in 37 files and all 25 Rust tests passed. The
desktop command completed its production frontend build and fresh debug Tauri
build before running the smoke flow.

The parser benchmark was generated at `2026-09-15T17:26:04.374Z` with Node
v26.8.2 on Linux x64. It is a single-run JSDOM microbenchmark, not desktop
interaction evidence. Representative many-short parse times were 68.7 ms at
100k visible characters, 489.1 ms at 1m, and 2,064.1 ms at 5m. Dense-link parse
times were 145.7, 1,251.3, and 6,141.8 ms. Dense-link reconstruction at 5m took
7,498.3 ms. The large-fixture costs remain visible rather than being described
as an accepted performance result.

## Open acceptance work

- Collect at least 20 desktop samples for cold paint, warm activation,
  input-to-paint, post-pause stalls, and process memory on a fixed build and
  fixture set.
- Repeat continuous-edit recovery measurements across the platform and load
  matrix. The current local smoke sequence passes, but it is only one run.
- Run Linux X11 and Wayland separately, Windows, and macOS where hardware is
  available. Use real OS IME input, not only synthetic composition events.
- Complete the controlled termination and replacement matrix, including
  Windows and the stated power-loss boundary.

R7 is locally implemented and the repository checks pass. The overall revisit
is not complete until these open acceptance items have evidence or the measured
exceptions receive explicit user acceptance.
