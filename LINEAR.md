# Linear Analysis

The linear analysis is a time‑ordered representation of a writing session that combines text edits, selections, navigation actions, and pauses into a single stream. Anything that is not literal text is encoded inside angle brackets, so it is easy to scan or parse.

## What It Produces

The linear output is built from these log sources:

- `text_records`: text snapshots used to derive insertions and deletions.
- `cursor_records`: selection ranges and cursor movements.
- `key_records`: navigation keys (left/right/up/down, enter).
- `header_records`: start/end timestamps for the session.

The output starts with `<START>` and ends with `<END>`.

## Activity Codes

- Inserted text appears as literal characters (no brackets).
- Deletions appear as `<DELETE>` or `<DELETEx>` where `x` is the number of deleted characters.
- Selections appear as `<SEL,start,end>` where `start` and `end` are cursor indices.
- Navigation keys appear as `<LEFT>`, `<RIGHT>`, `<UP>`, `<DOWN>`, and `<CR>` (enter).
- Cursor moves that are not insertions/deletions or named nav keys appear as `<NAV,pos>`.
- Pauses appear as `<seconds>` and are measured in seconds with two decimals.

## Pause Threshold

The linear output ignores short pauses. The threshold is user‑settable (default: `0.2` seconds) in the Replay & Analysis panel. Only gaps larger than or equal to the threshold are shown as `<seconds>`.

## How Insertions/Deletions Are Derived

Insertions and deletions are derived from diffs between consecutive `text_records` snapshots using `diff_match_patch`. The output sequence includes all text that was typed, even if later deleted.

## How Selections Are Derived

Selections come from `cursor_records` where `start !== end`. These are emitted as `<SEL,start,end>`.

## How Navigation Is Derived

Navigation is inferred from both key logs and cursor movement:

1) Named nav keys from `key_records` (left/right/up/down/enter) become `<LEFT>`, `<RIGHT>`, `<UP>`, `<DOWN>`, `<CR>`.
2) Cursor records that are not text edits and not selections can become `<NAV,pos>`.
3) If a cursor record timestamp falls between a matching keydown/keyup pair, it is treated as that nav key.
4) A small fuzz window (currently 30ms) allows cursor records slightly after keydown to still map to the nav key.
5) Cursor records are ignored if they share a timestamp with a text record or repeat the same cursor range as the immediately preceding cursor record.

## Grouping and Collapsing

Repeated adjacent actions are collapsed when there is no pause between them:

- `<LEFT><LEFT><LEFT>` becomes `<LEFT3>`.
- `<DELETE><DELETE>` becomes `<DELETE2>`.
- Repeated selection markers collapse into a single `<SEL,start,end>`.

## Example

```
<START><13.03>att mä<DELETE6>Att männisl<DELETE>kor har problem,
<DELETE2> är ingenting ovanligt och de proble jag <3.93><LEFT5>m
<RIGHT2><LEFT2><DELETE><2.23><RIGHT4> såg i filmen
varinge<DELETE4> inte så annorlunda<7.30>. <12.73>att
in<DELETE6><CR>Att vara utanför och iny<DELETE>te få vara
<2.68>med sina kal<DELETE2>s<DELETE>lasskamrater är
ingetnyttproblem, <5.05>
```

## Notes and Caveats

- The linear view is a derived analysis. It reflects how logs are collected, not a verbatim keystroke history.
- If key or cursor events are missing, some navigation actions may fall back to `<NAV,pos>`.
- Pauses are calculated between consecutive activities (including selections and navigation).
- Autocorrect detection is heuristic-based; other replacement patterns may exist and are not yet handled.
