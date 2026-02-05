# Process Graph

The process graph visualizes writing activity over time. It plots **time on the x‑axis** and three writing signals on the y‑axes, derived from the process logs.

## Axes
- **X‑axis**: time (milliseconds from the first recorded event to the last).
- **Right Y‑axis**: character counts (Process and Product).
- **Left Y‑axis**: pause lengths (seconds), shown as dots.

## Lines
1. **Process (blue)**
   - Accumulated count of all **user insertions** over time.
   - Only the user‑input portion of a text diff is counted (autocorrect/automatic edits are ignored).

2. **Product (green)**
   - Current **document length** at each text record timestamp.
   - Represents the size of the text after each recorded change.

3. **Position (dashed green)**
   - **Cursor (caret) position** over time.
   - Uses cursor records; it reflects where the writer’s cursor is after each event.

## Pauses
- **Pause dots (orange)** are placed using gaps between consecutive events.
- A pause is recorded when the time gap exceeds the user’s pause threshold.
- Dot height corresponds to pause duration in seconds.

## Data Sources
- **text_records**: drives Product and Process.
- **cursor_records**: drives Position.
- **header_records**: defines the session start/end timestamps when present.

## Notes
- The graph is updated when a note is selected and during replay.
- If no events exist, the graph clears and the time range resets.
