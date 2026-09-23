# Done-Gate

**File:** `extensions/done-gate.ts`

## Why
Two failures cost the most: output that looks done but doesn't work, and the agent stopping
before the whole request is done. Done-Gate fixes both, and you don't have to type anything.

## How it works
- It watches tool results. A successful `edit` or `write` marks the current run as "edited".
- When the agent finishes a run that edited files, Done-Gate queues **one** follow-up message:

  > [done-gate] Before you finish: (1) run or check what you changed and show the exact command
  > and its output as proof; (2) list anything from my request that is not done yet, and do it now.
  > If you already verified …, reply only with a one-line "Verified: <evidence>" and a one-line done list.

- The agent then verifies (or replies `Verified: …`) and stops.
- **It fires at most once per prompt you type.** Its own follow-up doesn't reset it, so it can't loop.
- It skips runs that were aborted (Esc) or ended in an error, and runs with no file edits
  (Q&A, or read-only `bash`/`powershell`).
- It also works in `-p` / JSON / RPC mode, so subagent workers verify their own work too.

## Controls
| Control | Effect |
|---|---|
| `/done-gate` or `alt+g` | Toggle on/off for this session |
| Status bar `gate ✓` | Shown while the gate is on |
| `PI_BOOST_DONE_GATE=off` | Start with the gate off (e.g. for subagent processes) |

## ADAPT points
- `MUTATING_TOOLS` at the top of the file: add any custom file-writing tools used at work.

## Tested (Pi 0.84.4 and 0.87.1, Haiku)
Q&A without edits: no gate. Edit task: exactly one gate, then the agent verifies and stops.
Abort mid-run: no gate. Toggled off: no gate. See `test/done-gate.test.ts` and `test/done_gate_rpc.py`.
