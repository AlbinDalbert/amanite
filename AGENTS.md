# AGENTS.md — Amanite

## Desktop/Tauri UI debugging default
- When debugging Amanite UI behavior, prefer the real Tauri desktop app over browser mock mode.
- Use the embedded WebDriver harness, not Playwright/CDP. The harness launches the real Tauri binary with a local WebDriver HTTP socket, normally `http://127.0.0.1:4445`.
- Start with:
  - `pnpm run tauri:webdriver:doctor`
  - `pnpm run tauri:webdriver:smoke`
  - `pnpm run tauri:webdriver:open` for an interactive/manual desktop session.
- For quick reruns after a valid debug build exists, use:
  - `pnpm run tauri:webdriver:smoke -- --skip-build`
- Screenshots and logs are written under `artifacts/tauri-webdriver/`.
- Build the WebDriver-capable desktop app through the Tauri CLI path used by the script (`pnpm exec tauri build --debug --no-bundle --features webdriver`), not plain `cargo build`, so the frontend assets are available.
- The `webdriver` Cargo feature is debug/test-only. Do not enable it for production builds.

## Fractal boundary
- Production project/page persistence goes through the `fractal::Project` API in the Tauri backend.
- Amanite presents the page body through the rich editor, rebuilds the complete HTML document at that UI boundary, and persists it with `Project::write_page`; do not add a second durable page format.
