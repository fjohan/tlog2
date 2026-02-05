# Linear Derivation and Debug Reporting

This document describes how the **linear representation** is produced in `tlog.replay.linear.js`, how debug output is generated, and how mismatch reports are exported/saved.

## Purpose
The linear representation is a human-readable compression of the writing process. It should preserve enough information to reconstruct text evolution while remaining interpretable.

## Input Data
The builder consumes:
- `text_records` (timestamp -> full text snapshot)
- `cursor_records` (timestamp -> `start:end`)
- `key_records` (timestamp -> `keydown/keyup: key`)
- optional `header_records` (session start/end)

## Linear Builder Pipeline
Entry point: `buildLinearData({ logs, entries, thresholdOverride })`.

1. Parse and sort events (`text`, `cursor`, `key`).
2. Keep only keydown events.
3. Map named keys to navigation tokens:
- `ArrowLeft/Right/Up/Down` -> `<LEFT>/<RIGHT>/<UP>/<DOWN>`
- `Enter/Return` -> `<CR>`
4. For unknown keydowns, derive a **simple diff** between nearest previous and next text records.
- Simple insert => text token
- Simple delete => `<DELETE>` token (collapsed later)
- Complex diff => unknown (`x`) fallback
5. Insert pauses (`<x.xx>`) when gaps exceed threshold.
6. Insert `<NAV,pos>` when required by cursor/diff heuristics.
7. Add `<START>` and `<END>` markers.

## Token Semantics
- Text token: inserted literal characters (spaces displayed as `<SPACE>` in render).
- Delete token: forward delete at `applyPos`, collapsible (`<DELETE3>`).
- Nav token: explicit cursor move (`<NAV,6>`).
- Navkey token: named keyboard navigation (`<LEFT2>`, `<CR>`).
- Unknown token: `x` when no reliable mapping exists.
- Pause token: `<seconds>`.

## Reconstruction Model
`applyTokenState()` replays tokens into `(text, pos)` state:
- `text` inserts at current/apply position.
- `delete` removes forward from current/apply position.
- `nav` sets position.
- `navkey` updates position and inserts newline for `<CR>`.

`rebuildToIndex(tokens, i)` reconstructs text up to token `i`.

## Debug Outputs
`buildDebugLines(tokens)` produces one line per token:
- rendered token
- reason/motivation (diff source, keydown source, collapse, nav insertion, catch-up)

Self-check lines (`CHECK ...`) compare reconstructed text with expected text at each keydown timestamp.

## UI Debug Methods
1. `linear_debug` status lines in output/report.
2. Clickable token inspection:
- each rendered token stores `actualText`
- click token => show reconstructed vs actual text side-by-side (column-by-column compare).
3. Mismatch counter in linear status.

## Report and Export
### Export Diffs (`Export diffs`)
Plain text export includes:
- `[diffs]` lines in format:
  - `prevCursor firstEq currCursor (op,"text") ...`
  - interleaved `CURSOR pos` lines
- `[linear_debug]`
- `[linear_steps]` (`index token | actual | reconstructed`)
- `[logs]` full logs JSON

### Report Button (`Report`)
Saves a server-side JSON report via `POST report.php` containing:
- note id/title/timestamp
- diffs
- rendered linear string
- linear debug lines
- linear step-through array
- full logs

`report.php` writes to `reports/report_<noteId>_<timestamp>.json` and returns saved path.

## Integration Checklist for Another Repo
1. Port `tlog.replay.linear.js` and `diff_match_patch` dependency.
2. Ensure access to text/cursor/key logs with millisecond timestamps.
3. Preserve token application semantics (`applyPos`, forward delete).
4. Include report/export surface for reproducibility.
5. Keep debug lines and step-through output enabled during integration.
6. Validate with known edge cases: paste, delete-repeat, replace, cursor jumps, enter/newline.

## Known Heuristic Areas
- Mapping unknown keydowns to simple diffs is heuristic-based.
- Cursor/nav inference may require tuning per keyboard/platform.
- Autocorrect/autocomplete can produce non-keydown text changes; catch-up diff logic is used to keep linear and reconstruction aligned.
