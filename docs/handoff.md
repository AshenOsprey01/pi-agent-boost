# Handoff

**File:** `extensions/handoff.ts` (derived from Pi's MIT example `examples/extensions/handoff.ts`)

## Why
Starting a new session usually means retyping a long prompt or keeping notes files. Handoff builds
the new session's opening prompt from the **live conversation**, so there are no files to keep.

## How to use
```
/handoff build the revenue chart for USDJPY
```
1. The conversation (Pi already truncates long tool results) and your goal go to the model.
2. The drafted prompt opens in a dialog for you to edit (Esc cancels).
3. A new session opens, linked to the old one as its parent, with the draft in the editor.
   Nothing is sent until you press Enter.

Interactive TUI only.

## What the draft carries
`## Goal`, `## Context` (what was done, decisions with reasons, constraints and preferences,
verified facts), `## Files` (exact paths), `## Open items`. It omits dead ends and chatter, never
invents facts, and lists open choices under Open items instead of deciding them.

Example (Haiku 4.5, after a short session on synthetic data):
```
## Goal
Build a revenue chart for USDJPY trades and save it as PNG in the charts/ folder.
## Context
- Decisions made:
  - Revenue formula: `revenue = notional * revenue_bps / 10000` in the notional currency.
  - Use pandas only, never polars.
- rates.csv does not exist.
## Open items
- Chart type not specified. Clarify what breakdown the USDJPY revenue chart should show.
```

## Config
| Env var | Default | Meaning |
|---|---|---|
| `PI_BOOST_HANDOFF_MODEL` | current session model | `provider/modelId` for a cheaper drafting model |

## Changes from Pi's example
A richer system prompt (decisions, constraints, verified facts, no dead ends, no inferences), an
optional model override, errors shown instead of silently reported as "Cancelled", and a fallback
(draft into the current editor) if `ctx.newSession` is missing. It exists on 0.84.4 and 0.87.1.

## Tested
`test/handoff-harness.ts` drafts a handoff from a real `-p` conversation on both versions.
Opening the new session is checked by hand: run `/handoff <goal>` after a short chat.
