# Amanite

Amanite is a desktop editor for [Fractal](../fractal), a file-backed HTML knowledge base and graph engine.

The app is being rebuilt from the original Avalonia/.NET starter into a web-native desktop shell:

- Tauri 2 for the desktop host and Rust integration.
- React and Vite for the frontend.
- Lexical for the rich editor surface.
- Fractal Rust crate integration for validation, indexing, page creation, and note/page mutation.

## Current Status

This is an active Tauri/React desktop app with project creation/opening, page navigation and mutation, rich Lexical editing, notes, validation, and index-building wired to real Fractal project files.

The create/open project flow is backed by the Fractal Rust crate. The frontend talks through `src/lib/fractal`, which keeps Fractal/Tauri integration out of React feature components while the crate API continues to evolve. The current KISS architecture boundary is documented in [`docs/architecture.md`](docs/architecture.md): Fractal owns truth; Amanite presents and edits it.

## Requirements

- Node.js and pnpm.
- Rust and Cargo.
- Tauri's Linux system dependencies when building on Linux.

On Arch Linux, Tauri commonly needs WebKitGTK and related desktop packages installed through `pacman`.

## Development

Install frontend dependencies:

```sh
pnpm install
```

Run the Vite frontend only:

```sh
pnpm run dev
```

This is useful for frontend build feedback, but Fractal project access requires the Tauri runtime. For UI debugging against the real backend, prefer the WebDriver harness below.

Run the desktop app:

```sh
pnpm run tauri:dev
```

Run a real Tauri desktop smoke/debug session through the embedded WebDriver
harness:

```sh
pnpm run tauri:webdriver:doctor
pnpm run tauri:webdriver:smoke
pnpm run tauri:webdriver:open
```

See [`docs/tauri-webdriver.md`](docs/tauri-webdriver.md) for details.

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
├── src-tauri/           Tauri 2 Rust host and Fractal adapter
├── docs/                Architecture notes, todos, and desktop debug docs
├── index.html           Vite entry HTML
├── package.json         frontend and Tauri CLI scripts
└── vite.config.ts       Vite/Tauri dev server config
```

## Near-Term Plan

Start with [`docs/current-focus.md`](docs/current-focus.md) when you need the shortest working-memory version, [`docs/feature-inventory.md`](docs/feature-inventory.md) when you need to know what exists today, and [`docs/code-map.md`](docs/code-map.md) when you need to understand how the code hangs together. See [`docs/todo.md`](docs/todo.md) for the technical-debt backlog. The previous `FractalEditor.tsx` decomposition is mostly complete; the current priority is keeping Amanite thin over Fractal, documenting boundaries, and splitting the broad Tauri backend adapter only when it makes changes safer.
