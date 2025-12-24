# Repository Guidelines

## Project Structure & Module Organization
This repository is a single-file web app. The entire UI, styles, and logic live in `tlog.html`, which contains the HTML markup, inline CSS, and a self-contained JavaScript app that uses IndexedDB for storage. There are no separate assets, build outputs, or test directories.

## Build, Test, and Development Commands
There is no build system or package manager. To run locally, open the file directly in a browser:

- `open tlog.html` (macOS) or `xdg-open tlog.html` (Linux)

If you need a local server (e.g., for stricter browser policies), use any static server you prefer and point it at this directory.

## Coding Style & Naming Conventions
Keep edits consistent with the existing single-file style:

- Indentation: 2 spaces in HTML/CSS/JS.
- JavaScript: prefer `const`/`let`, arrow functions, and small helper functions.
- Naming: use camelCase for JS variables/functions and kebab-case for CSS classes.
- Keep UI strings short and actionable (e.g., button labels like `Export logs`).

No formatter or linter is configured. Avoid introducing new dependencies.

## Testing Guidelines
There is no automated test framework in this repo. Validate changes manually:

- Open `tlog.html` in a browser.
- Create a note, edit the body, and verify autosave and logging counts update.
- Export logs and confirm a JSON download occurs.

## Commit & Pull Request Guidelines
No Git history or conventions are present in this repository. If you add commits, use clear, imperative messages (e.g., `Add log export button`) and include a brief description of user-facing changes. For pull requests, include:

- A summary of behavior changes.
- Any manual test steps performed.
- Screenshots only if UI layout changes.

## Configuration & Data Storage Notes
The app stores notes and process logs in the browser’s IndexedDB (`keep_lite_db`). Clearing site data or browser storage will remove notes. Export JSON before making invasive changes to logging or storage behavior.
