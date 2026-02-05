# Repository Guidelines

## Project Structure & Module Organization
This repository is a small static web app split into HTML, CSS, and JS modules. Key files:

- `tlog.html`: markup and script includes, plus the replay/record panel layout.
- `tlog.css`: styling for the editor, replay UI, progress graph, and revision table.
- `tlog.js`: core app logic (notes, IndexedDB, logging, UI state).
- `tlog.replay.core.js`: replay controls and text/cursor playback logic.
- `tlog.replay.graph.js`: progress graph rendering.
- `tlog.replay.table.js`: revision table generation using `diff_match_patch`.
- `tlog.replay.linear.js`: linear analysis output and pause threshold handling.
- `LINEAR.md`: format and heuristics for linear analysis.
- `../../simple/diff_match_patch.js`: local diff library used for revision table diffs.

## Build, Test, and Development Commands
There is no build system or package manager. To run locally, open the file directly in a browser:

- `open tlog.html` (macOS) or `xdg-open tlog.html` (Linux)

If you need a local server (e.g., for stricter browser policies), use any static server you prefer and point it at this directory.

## Coding Style & Naming Conventions
Keep edits consistent with the existing lightweight modular style:

- Indentation: 2 spaces in HTML/CSS/JS.
- JavaScript: prefer `const`/`let`, arrow functions, and small helper functions.
- Naming: use camelCase for JS variables/functions and kebab-case for CSS classes.
- Keep UI strings short and actionable (e.g., button labels like `Export logs`).

No formatter or linter is configured. Avoid introducing new dependencies; when needed, prefer local scripts like `diff_match_patch.js`.

## Testing Guidelines
There is no automated test framework in this repo. Validate changes manually:

- Open `tlog.html` in a browser.
- Create a note, edit the body, and verify autosave and logging counts update.
- Switch to Replay & Analysis and ensure the progress graph and revision table update on note selection.
- Export logs and confirm a JSON download occurs.
- Use `Load logs` to import an exported JSON file (either full export or a raw `logs` object) and verify the replay, graph, table, and linear output refresh.

## Commit & Pull Request Guidelines
No Git history or conventions are present in this repository. If you add commits, use clear, imperative messages (e.g., `Add log export button`) and include a brief description of user-facing changes. For pull requests, include:

- A summary of behavior changes.
- Any manual test steps performed.
- Screenshots only if UI layout changes.

## Configuration & Data Storage Notes
The app stores notes and process logs in the browser’s IndexedDB (`keep_lite_db`). Clearing site data or browser storage will remove notes. Export JSON before making invasive changes to logging or storage behavior.
