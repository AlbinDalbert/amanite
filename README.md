# Amanite

Amanite is a desktop editor for [Fractal](../fractal), a file-backed HTML knowledge base and graph engine.

The app is being rebuilt from the original Avalonia/.NET starter into a web-native desktop shell:

- Tauri 2 for the desktop host and Rust integration.
- React and Vite for the frontend.
- CodeMirror 6 for the HTML editor surface.
- Fractal CLI integration for validation, indexing, import/export, page creation, and note mutation.

## Current Status

This is an initial scaffold. It includes a Tauri app shell, a React workspace layout, and a CodeMirror HTML editor loaded from real Fractal project files.

The create/open project flow is backed by the Fractal Rust crate. The frontend talks through `src/lib/fractal`, which keeps Fractal/Tauri integration out of React feature components while the crate API continues to evolve.

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

When this runs outside Tauri, Amanite uses a browser-only mock Fractal
library backed by `localStorage`. It is meant for UI debugging with Playwright
or browser devtools; it does not read or write local Fractal project files.
Use the Tauri command below for real filesystem-backed projects.

Run the desktop app:

```sh
pnpm run tauri:dev
```

By default, Amanite stores its development projects in the app data directory
under `projects`. Set `AMANITE_PROJECT_ROOT` when you want Create/Open to use a
specific project library directory instead:

```sh
AMANITE_PROJECT_ROOT="$HOME/fractal-projects" pnpm run tauri:dev
```

You can also put it in a repo-local `.env` file:

```env
AMANITE_PROJECT_ROOT=/home/chell/fractal-projects
```

Use an absolute path in `.env`; `~` is not expanded there.

`AMANITE_PROJECT_ROOT` points at a parent folder containing Amanite-created or
existing Fractal projects. When you create a project, Amanite asks for a display
name, derives a safe child directory name from it, and runs Fractal's project
initializer in that child directory. A new project contains `fractal.json`,
`.fractal/style.css`, `.fractal/index.json`, `.fractal/graph.json`, and
`pages/index.html`. Open lists valid Fractal project directories found directly
under `AMANITE_PROJECT_ROOT`.

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
├── src/
│   ├── app/             App orchestration and top-level state
│   ├── components/ui/   Shared UI primitives, including future shadcn output
│   ├── features/        Feature-owned React components
│   └── lib/fractal/     Typed frontend adapter for Fractal/Tauri calls
├── src-tauri/           Tauri 2 Rust host
├── index.html           Vite entry HTML
├── package.json         frontend and Tauri CLI scripts
└── vite.config.ts       Vite/Tauri dev server config
```

## Near-Term Plan

- Load Fractal pages from `pages/`.
- Read `.fractal/index.json` for navigation.
- Add Tauri commands that call the `fractal` CLI.
- Wire toolbar actions to `fractal validate` and `fractal index build`.
- Keep source editing and preview separate until the HTML mutation rules settle.
