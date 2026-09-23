# Output Trimmer

**File:** `extensions/output-trimmer.ts`

## Why
Pi's default tool-output cap is 50 KB (about 10k tokens). DataFrame prints, SQL dumps, and install
logs bloat the context and the bill, even though the model rarely needs more than the start and
the end.

## How it works
- It runs on every `bash` and `powershell` tool result. If the text is larger than
  `PI_BOOST_TRIM_BYTES` (default **8000**), the model gets:
  - the **head** (~3 KB) and the **tail** (~3 KB), cut on line boundaries, with one note in between:
    `… [output-trimmer: N lines / X KB omitted — full output: <path> — use read to see more]`
- The full output is saved to `<temp>/pi-boost/<toolCallId>.txt`. If Pi already saved a full-output
  file (because the output was over Pi's own 50 KB cap), the note points to **Pi's** file instead,
  since it has the complete output.
- Pi's own truncation note (`[Showing lines … Full output: …]`) is kept at the end. `isError` is unchanged.
- `read` results are never trimmed; the agent asked for those explicitly.
- Files older than 7 days in `<temp>/pi-boost/` are removed at session start.

Measured (Pi 0.84.4 and 0.87.1): a 100 KB output → 6.2 KB for the model, with a path to the full
102 KB file; a 29 KB output → 6.1 KB, with its own saved copy; a 31 KB `read` → untouched.

## Config
| Env var | Default | Meaning |
|---|---|---|
| `PI_BOOST_TRIM_BYTES` | 8000 | Trim threshold in bytes. Head and tail are each 37.5% of it. `0` disables the tool. |

## ADAPT points
- `SHELL_TOOLS` at the top of the file: add any custom shell tool names used at work.

## Tested
`test/output-trimmer.test.ts` (small output untouched, 100 KB → ~6 KB with correct line
accounting, Pi note preserved, giant single line, disabled). Real runs with
`test/run-scenario.sh` + `test/trimmer_check.py` on both versions.
