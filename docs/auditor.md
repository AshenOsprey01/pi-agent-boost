# Auditor

**File:** `agents/auditor.md` (a subagent definition, not an extension)

## Why
Wrong numbers are the most expensive failure in dashboard and revenue work. The agent that wrote
the code tends to trust it. The Auditor starts with a **fresh context**, recomputes the key figures
**independently from the raw data**, and walks a checklist of FX/Rates traps.

## What it does
1. Finds the claim: which figures, from which source, filters, units, and period.
2. Picks the 2-3 figures that matter most and recomputes each with its own simple code
   (never reusing the other agent's functions or queries).
3. Reads the code that produced the figures and checks it against the trap list: quote direction,
   notional currency, pip size, bps/%/decimal, signs, day count, date filters and T+2, timezone
   cut-offs, join double counting, nulls, stale rates, averages of averages, duplicate rows.
4. Replies with a compact table: `PASS` / `FAIL` / `UNSURE` per figure with the delta, the exact
   commands as evidence, issues ranked by severity with file:line and a one-line fix, and what it
   could not check.

It is read-only: it never edits files and only runs Python or `SELECT` queries to compute.

## Install
Pi packages cannot ship subagents, so copy the file by hand. It needs a subagent extension.

With Pi's example subagent extension (`examples/extensions/subagent/`), user agents live in
`~/.pi/agent/agents/`:
```powershell
New-Item -ItemType Directory -Force "$HOME\.pi\agent\agents"
```
```powershell
Copy-Item agents\auditor.md "$HOME\.pi\agent\agents\auditor.md"
```
Then ask the agent, for example: *"Use the auditor to check the numbers in revenue_by_pair.csv."*

## ADAPT at work
- **Frontmatter:** match your subagent format (field names, how tools are listed). The body (the
  system prompt) is the part that matters and should carry over unchanged.
- **Model:** the `model:` line is commented out, so the auditor uses the calling session's model.
  To pin one, uncomment it and use the exact ID from `/model` (a Sonnet for quality, Haiku for cost).
- **Tools:** `data_peek` is listed so the auditor profiles data cheaply when Data Peek is installed.
  Pi ignores unknown tool names in `--tools` (checked on 0.84.4 and 0.87.1), so it is harmless otherwise.
- **Python / SQL:** it runs `python` from bash. If your work Python has another name, or your DB is
  only reachable through a client, add one line about it to the Rules section.

## Tested
`test/auditor-test.sh <new|old> [clean]` copies a small report script with a **planted bug** into
`test/tmp/audit-work`, puts the auditor in that folder's `.pi/agents/`, and loads Pi's example
subagent extension with `-e` for that run only (nothing is installed into `~/.pi`).

The planted bug converts every notional with `notional * rate`, which is wrong for USDJPY
(the notional is already USD), so USDJPY revenue is about 150 times too big.

| Run | Result (Haiku as main agent and auditor, about $0.08-0.10 each) |
|---|---|
| 0.87.1, bug | FAIL: USDJPY 62.6M reported vs 417K recomputed, correct cause. Also flagged the fixture's duplicate trade row |
| 0.87.1, bug fixed | Conversion passes. Still FAIL for the duplicate row, which is a real issue in the fixture, so no false positive |
| 0.84.4, bug | FAIL: same USDJPY finding with verbatim commands, fix driven by `notional_ccy`, plus the duplicate |

Known Haiku weakness: file:line references can be one line off. A Sonnet-class model is the
recommended auditor at work.
