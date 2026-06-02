# Amanite

Amanite is a desktop editor for [Fractal](../fractal), a file-backed HTML knowledge base and graph engine.

The app is being rebuilt from the original Avalonia/.NET starter into a web-native desktop shell:

- Tauri 2 for the desktop host and Rust integration.
- React and Vite for the frontend.
- CodeMirror 6 for the HTML editor surface.
- Fractal CLI integration for validation, indexing, import/export, page creation, and note mutation.

## Current Status

This is an initial scaffold. It includes a Tauri app shell, a React workspace layout, and a CodeMirror HTML editor seeded with a Fractal-style page document.

The Fractal engine is not wired into the UI yet. The intended first integration is to call the existing `fractal` CLI from Tauri commands, keeping the engine boundary explicit while Fractal continues to evolve.

## Requirements

- Node.js and npm.
- Rust and Cargo.
- Tauri's Linux system dependencies when building on Linux.

On Arch Linux, Tauri commonly needs WebKitGTK and related desktop packages installed through `pacman`.

## Development

Install frontend dependencies:

```sh
pnpm install
```

Run the web frontend only:

```sh
pnpm run dev
```

Run the desktop app:

```sh
pnpm run tauri:dev
```

Build frontend assets:

```sh
pnpm run build
```

Build the Tauri app:

```sh
pnpm run tauri:build
```

## Project Layout

```text
.
├── src/                 React frontend
├── src-tauri/           Tauri 2 Rust host
├── index.html           Vite entry HTML
├── package.json         frontend and Tauri CLI scripts
└── vite.config.ts       Vite/Tauri dev server config
```

## Near-Term Plan

- Add project open/create flows.
- Load Fractal pages from `pages/`.
- Read `.fractal/index.json` for navigation.
- Add Tauri commands that call the `fractal` CLI.
- Wire toolbar actions to `fractal validate` and `fractal index build`.
- Keep source editing and preview separate until the HTML mutation rules settle.
