# Tauri Desktop WebDriver Debugging

Amanite can be driven as the real Tauri desktop app through an embedded WebDriver server. This is for desktop debugging and smoke tests; it does not use the browser mock.

## Commands

```sh
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
pnpm run tauri:webdriver:open
```

- `tauri:webdriver:doctor` checks the local prerequisites.
- `tauri:webdriver:smoke` builds Amanite with the `webdriver` Cargo feature, launches the real desktop binary, creates a real Fractal project in a temp artifact directory, and writes screenshots under `artifacts/tauri-webdriver/`.
- `tauri:webdriver:open` does the same but keeps the desktop window open until Enter is pressed.

## How it works

The `webdriver` Cargo feature enables `tauri-plugin-wdio-webdriver`, which starts a local WebDriver HTTP server inside the Tauri app when `TAURI_WEBDRIVER_PORT` is set. The Node script in `scripts/tauri-desktop-debug.mjs` then talks to that W3C WebDriver endpoint directly.

This avoids the external `tauri-driver` + `WebKitWebDriver` stack, which is awkward on this Arch install because the packaged WebKitGTK does not ship `WebKitWebDriver`.

## Useful options

```sh
node scripts/tauri-desktop-debug.mjs --keep-open --port 4455
node scripts/tauri-desktop-debug.mjs --project-root /tmp/amanite-projects
node scripts/tauri-desktop-debug.mjs --skip-build
```

Environment equivalents:

```sh
AMANITE_PROJECT_ROOT=/tmp/amanite-projects pnpm run tauri:webdriver:open
TAURI_WEBDRIVER_PORT=4455 pnpm run tauri:webdriver:smoke
AMANITE_TAURI_WEBDRIVER_SKIP_BUILD=1 pnpm run tauri:webdriver:smoke
```

Never enable the `webdriver` Cargo feature for production builds; it exposes local automation over HTTP.
