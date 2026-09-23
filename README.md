# pi-agent-boost

Small, general-purpose [Pi](https://github.com/earendil-works/pi) tools that make the agent
produce better, more complete output while you type less, read less, and spend less.

No per-project setup, no context files to maintain. Every tool works with zero config.
Tested on Pi **0.84.4** and **0.87.1** (Windows 11).

## Tools

| Tool | Type | What it does | More |
|---|---|---|---|
| Done-Gate | extension | After the agent edits files, sends it back **once** to prove the change works and finish leftovers | [Done-Gate](#done-gate) |
| Data Peek | extension + Python | `data_peek` tool returns a compact (≤ 4 KB) profile of a file or SQL table/query, so the agent never guesses columns or units | [Data Peek](#data-peek) |
| Prompt Sharpener | extension | `alt+e` rewrites your editor draft into a clear prompt with a fast model. Never adds facts, never sends | [Prompt Sharpener](#prompt-sharpener) |
| Output Trimmer | extension | Caps large `bash`/`powershell` outputs at ~6 KB for the model and points to the full output file | [Output Trimmer](#output-trimmer) |
| Handoff | extension | `/handoff <next task>` opens a new session with a drafted, focused prompt from the live conversation | [Handoff](#handoff) |
| Auditor | subagent definition | Read-only, fresh-context numbers checker: recomputes key figures, checks FX/Rates traps | [Auditor](#auditor) |
| Hygiene Rules | extension | Adds short project-hygiene rules (comments, one AGENTS.md, temporary PLAN/TODO, task branches) to every session | [Project hygiene](#project-hygiene) |
| Hygiene Guard | extension | Blocks new stray md files, an AGENTS.md over the cap, and edits on main/master | [Project hygiene](#project-hygiene) |
| Project Cleanup | skill + Python | One-time staged cleanup of a project: md files → one AGENTS.md, restating comments out, dead code out | [Project hygiene](#project-hygiene) |
| Snippets | `.md` files | Show evidence · Finish everything · Number hygiene, for a prompt-snippets extension | [snippets/](snippets/) |

### Keys and commands

| Key / command | Tool | Action |
|---|---|---|
| `alt+g` or `/done-gate` | Done-Gate | Toggle on/off (status bar shows `gate ✓` when on) |
| `alt+e` or `/sharpen <text>` | Prompt Sharpener | Sharpen the draft into the editor |
| `alt+shift+e` or `/unsharpen` | Prompt Sharpener | Put the original draft back (editor undo `ctrl+-` also works) |
| `/handoff <goal>` | Handoff | Draft a prompt and open a new session with it |

## Install

The extensions install as one Pi package (needs git access to github.com):
```powershell
pi install git:github.com/AshenOsprey01/pi-agent-boost
```
Then run `/reload` in Pi (or restart it). To try it for one run without installing:
```powershell
pi -e git:github.com/AshenOsprey01/pi-agent-boost
```

**Data Peek** needs a Python with pandas (plus `pyarrow` for Parquet, `openpyxl` for Excel, and
`sqlalchemy` + your DB driver for SQL mode):
```powershell
python -m pip install pandas pyarrow openpyxl sqlalchemy
```

**Auditor and snippets** are not Pi package resource types, so copy them by hand. Pi clones git
packages to `~\.pi\agent\git\github.com\AshenOsprey01\pi-agent-boost`:
```powershell
$boost = "$HOME\.pi\agent\git\github.com\AshenOsprey01\pi-agent-boost"
```
The Auditor needs a subagent extension. For Pi's example subagent extension, user agents live in `~\.pi\agent\agents`:
```powershell
New-Item -ItemType Directory -Force "$HOME\.pi\agent\agents"; Copy-Item "$boost\agents\auditor.md" "$HOME\.pi\agent\agents\"
```
The snippets go wherever your prompt-snippets extension keeps its snippets, for example:
```powershell
Copy-Item "$boost\snippets\*.md" "$HOME\.pi\agent\extensions\prompt-snippets\snippets\"
```
Run `/reload` afterwards.

## Configuration

No config files. Everything is optional, set through environment variables starting with `PI_BOOST_`.

| Env var | Tool | Default | Meaning |
|---|---|---|---|
| `PI_BOOST_DONE_GATE` | Done-Gate | on | `off` starts with the gate disabled |
| `PI_BOOST_SHARPEN_MODEL` | Prompt Sharpener | newest available Haiku, else session model | `provider/modelId` of the rewrite model |
| `PI_BOOST_PYTHON` | Data Peek | `python` (Windows) / `python3` | Python that has pandas, e.g. a venv's `python.exe` |
| `PI_BOOST_DB_URL` | Data Peek | not set | SQLAlchemy URL for SQL mode. Never printed, scrubbed from errors |
| `PI_BOOST_PEEK_MAX_ROWS` | Data Peek | 1,000,000 | Max file rows read for a profile |
| `PI_BOOST_PEEK_SQL_ROWS` | Data Peek | 50,000 | Max SQL rows fetched for a profile |
| `PI_BOOST_TRIM_BYTES` | Output Trimmer | 8000 | Trim shell outputs larger than this; `0` disables |
| `PI_BOOST_HANDOFF_MODEL` | Handoff | session model | `provider/modelId` of a cheaper drafting model |
| `PI_BOOST_RULES` | Hygiene Rules | on | `off` stops adding the hygiene rules to the system prompt |
| `PI_BOOST_GUARD` | Hygiene Guard | on | `off` disables all three guard checks |

Set one for your user account (new terminals pick it up; restart Pi afterwards):
```powershell
[Environment]::SetEnvironmentVariable("PI_BOOST_TRIM_BYTES", "12000", "User")
```
Or only for the current terminal:
```powershell
$env:PI_BOOST_TRIM_BYTES = "12000"
```
Keep `PI_BOOST_DB_URL` out of files you commit. If it holds a password, prefer a driver option
that uses Windows authentication.

## Done-Gate

Output that looks done but doesn't work, and an agent that stops before the whole request is done,
cost the most. After a run in which the agent changed files (`edit`/`write`), Done-Gate sends it back
**once** with a `[done-gate]` message: prove the change works (exact command + output), finish anything
still open, and drop comments that only restate the code. If it already verified, it replies with one
`Verified: …` line.
- Fires at most once per prompt you type. Its own follow-up doesn't reset it, so it can't loop.
- Skips runs with no file edits (Q&A, read-only shell commands), runs aborted with Esc or ended in an
  error, and runs whose last line is `OK to continue?` (a staged workflow waiting for your approval).
- Also works in `-p` / JSON / RPC mode, so subagent workers verify their own work.
- `alt+g` or `/done-gate` toggles it. The status bar shows `gate ✓` while it is on.

## Data Peek

Agents guess column names, types, units and date formats. The `data_peek` tool lets the data describe
itself: one ≤ 4 KB profile instead of dumping a file or running many exploratory queries. Its
description tells the model to profile a dataset before writing code or SQL for it.

| Parameter | Meaning |
|---|---|
| `source` | File path (`.csv .tsv .parquet .xlsx .json .jsonl`) relative to cwd, or `"sql"` |
| `query` | For `sql`: a table name (`schema.table` ok) or one `SELECT`/`WITH` statement |
| `sample_rows` | Sample rows to show (default 5, max 20) |
| `columns` | Only profile these columns (for wide tables) |

The profile has the shape, duplicate-row count, and per column: dtype, null %, distinct count,
min/max/mean or date range, top values or examples, plus flags for text that parses as dates and
numbers stored as text. Then a few sample rows. Example (synthetic data):
```
shape: 201 rows x 10 columns
duplicate rows: 1
- trade_date  [str]  nulls 0%  distinct 58  range 2026-01-05 .. 2026-03-06  FLAG: text that parses as dates
- ccy_pair  [str]  nulls 0%  distinct 3  top: GBPUSD 75, EURUSD 67, USDJPY 59
- revenue_bps  [float64]  nulls 1%  distinct 177  min -1.98  max 7.99  mean 3.0797
```
**SQL mode** needs SQLAlchemy and `PI_BOOST_DB_URL`. The URL is never printed and errors are scrubbed.
It is read-only: only a table name or a single `SELECT`/`WITH` is accepted (writes, `SELECT … INTO` and
multiple statements are refused), and the connection is never committed. A missing library gives a
clear `pip install …` message.

## Prompt Sharpener

Type a rough draft and press `alt+e`: a fast, cheap model rewrites it in place (Esc cancels while it
runs). It never sends; you review and press Enter. `/sharpen <text>` does the same with the draft as
the argument. `alt+shift+e` or `/unsharpen` puts the original back, and so does the editor undo `ctrl+-`.
Interactive TUI only. About $0.001 per rewrite on Haiku 4.5.
- Sends only the draft, the last user/assistant exchange (≤ ~3,000 characters, so "it"/"that" can be
  resolved) and the cwd folder name.
- Keeps intent, voice, language and every piece of information, including hunches. Never invents facts,
  files, columns or numbers. Code, paths and identifiers stay verbatim. Short drafts stay short.
- Model: `PI_BOOST_SHARPEN_MODEL` if set, else the newest available Haiku (skips `:batch` variants,
  ranks `…-latest` aliases last), else the session model. The loader shows which one and why.
```
draft:  pls fix teh revenue chart it shows wrong totals for usdjpy i think its the join in rev_by_desk.sql?? also make the y axis in bps not %
result: Fix the revenue chart. I suspect the join in rev_by_desk.sql is causing wrong totals for USDJPY. Change the y-axis from % to bps.
```

## Output Trimmer

Pi's default tool-output cap is 50 KB (about 10k tokens), and DataFrame prints, SQL dumps and install
logs rarely need more than their start and end. For `bash`/`powershell` results over
`PI_BOOST_TRIM_BYTES` (8000), the model gets the head and tail (~3 KB each, cut on line boundaries)
and a note with the path to the full output: Pi's own full-output file if Pi saved one, else
`<temp>/pi-boost/<toolCallId>.txt` (removed after 7 days). `read` results are never trimmed.
A 100 KB output becomes about 6 KB.

## Handoff

`/handoff <goal>` (e.g. `/handoff build the revenue chart for USDJPY`) drafts the opening prompt of a new
session from the live conversation, so there is nothing to retype and no notes file to keep. The draft
has `Goal`, `Context` (what was done, decisions with reasons, constraints, verified facts), `Files` and
`Open items`. It leaves out dead ends, never invents facts, and lists open choices instead of deciding them.
You edit the draft in a dialog (Esc cancels), then a new session opens, linked to the old one, with the
draft in the editor. Nothing is sent until you press Enter. Interactive TUI only.

Derived from Pi's example `handoff.ts` (MIT), with a richer prompt, the optional `PI_BOOST_HANDOFF_MODEL`,
visible errors, and a fallback (draft into the current editor) if `ctx.newSession` is missing.

## Auditor

Wrong numbers are the most expensive failure in dashboard and revenue work, and the agent that wrote the
code tends to trust it. The Auditor (`agents/auditor.md`) is a read-only subagent with a fresh context. It
picks the 2–3 figures that matter most, recomputes them from the raw data with its own code, checks the
code against FX/Rates traps (quote direction, notional currency, pip size, bps/%/decimal, signs, day count,
date filters and T+2, cut-offs, join double counting, nulls, stale rates, duplicates), and replies with
`PASS`/`FAIL`/`UNSURE` per figure, the exact commands as evidence, and issues ranked by severity with
file:line and a fix. It never edits files. Install it as described under [Install](#install), then ask
e.g. *"Use the auditor to check the numbers in revenue_by_pair.csv."* A Sonnet-class model is
recommended (Haiku's file:line references can be one line off).

## Project hygiene

Agents tend to fill projects with comments that restate the code and with md files (PLAN, TODO,
DECISIONS, CHANGELOG...) that go stale and mislead the next agent. These parts keep a project at
one short `AGENTS.md` plus code with only WHY comments.

**Hygiene Rules** (`extensions/hygiene-rules.ts`) appends a ~1.5 KB rule block to the system prompt
of every turn: comment only WHY / business rules / warnings, the only lasting md file is `AGENTS.md`
(max 200 lines / 16,000 characters), PLAN.md and TODO.md are temporary, one place per fact, remove
dead code, and work on a task branch instead of main (never switching branches in a folder another
agent may use). Pi packages cannot ship an AGENTS.md, so the rules come from an extension.

**Hygiene Guard** (`extensions/hygiene-guard.ts`) checks every `write`/`edit` call and blocks it
with a reason that says what to do instead:
- **New md file:** only `AGENTS.md`, `PLAN.md` and `TODO.md` may be created. Editing an existing md
  file is fine. Always allowed: `SKILL.md` and anything in a skill folder, files under a `prompts`,
  `snippets` or `agents` folder, and anything in an Obsidian vault (a parent folder has `.obsidian`).
- **AGENTS.md cap:** the resulting file would be over 200 lines or 16,000 characters.
- **main/master:** the file is in a git repo on `main` or `master`. The agent is told to run
  `git switch -c <task>` first. Not blocked: non-git folders, detached HEAD, a repo with no commits
  yet, Obsidian vaults.

Known gap: files created through `bash`/`powershell` are not checked. The rules and Done-Gate cover that.

**Project Cleanup skill** (`skills/project-cleanup/`) cleans up an existing project once. In the
project folder, ask Pi "clean up this project" or run `/skill:project-cleanup`. It works on a
`cleanup/<date>` branch in five stages and pauses for your OK after each one:
0. Preflight: clean git tree, asks whether the repo is for others (keeps a short README) or only for you, runs the report.
1. Merges all md files into one AGENTS.md. Every fact is checked against the code: stale or contradicted facts
   are dropped, facts about one spot in the code become a WHY comment there.
2. Removes comments that restate code, file headers, TODOs, commented-out code. Comment-only: `verify-py`
   proves the Python code is unchanged (same syntax tree without docstrings).
3. Lists dead code and duplicates with evidence (ruff, vulture, grep). Deletes only what you approve.
4. Summary, then merges into main and pushes if there is a remote. The branch stays for comparing or reverting.

One commit per stage (per batch in Stage 2), so any stage can be reverted. Use **Sonnet or better** for real
runs: the stages are mostly judgement. Haiku passes the test project but sometimes skips a pause. Stage 3 asks
before installing ruff/vulture (`pip install ruff vulture`, in the project's venv if it has one).

The report works on its own too (stdlib Python, output under 4 KB):
```powershell
python skills\project-cleanup\scripts\hygiene_report.py report C:\path\to\project
```

Done-Gate stays quiet when the agent's last line is `OK to continue?`, so it does not push a staged
workflow past a pause.

## Parallel agents (one git worktree per task)

To run 2–3 Pi sessions on one repo at the same time (e.g. one per dashboard tab), give each its own
folder with `git worktree`. A folder can only have one branch checked out, so sessions sharing a
folder would switch branches under each other. Worktrees share one repo, so merging stays easy.

From the main project folder, create one worktree per task:
```powershell
git worktree add ..\fx-dashboard-usdjpy -b usdjpy-tab
```
Open a new Windows Terminal tab, go there and start Pi:
```powershell
cd ..\fx-dashboard-usdjpy; pi
```
When you tell the agent "OK, merge", it merges its branch in the folder that has main checked out
(Hygiene Rules tell it how). Then remove the worktree:
```powershell
git worktree remove ..\fx-dashboard-usdjpy
```
- Sessions never overwrite each other's files, but two branches that change the same file can conflict
  at merge time. The second merge resolves it. Keep each task mostly in its own files and merge often.
- To pick up the others' merged work, tell the agent to run `git merge main` in its folder.
- Gitignored files (`.venv`, `.env`, data) are not in a new worktree. Create a venv there or reuse the main one.
- Hygiene Guard checks the branch of each file's own folder, so worktrees on task branches are allowed
  while the main folder stays protected.

## Work setup (global AGENTS.md)

Your global `~\.pi\agent\AGENTS.md` is loaded into every session, so it must not contradict the
hygiene rules. Open it with `notepad "$HOME\.pi\agent\AGENTS.md"` and:
- Where it asks for a `PLAN.md` / `TODO.md`, add: *"Both are temporary: delete them when the task is done."*
- Where it asks for a comment at the top of every file or extension, drop that part
  (e.g. "One file, one job, a comment at the top saying what it does." → "One file, one job.").
- Remove any rule that asks for extra md files (DECISIONS, CHANGELOG, notes...) or for explanatory comments.

Run `/reload` in Pi afterwards.

## Adapting at work (ADAPT checklist)

Every work-specific spot is marked `ADAPT:` in the code. In order of likelihood:

1. **Data Peek DB connection:** `extensions/data-peek/profile.py`, block marked `# ADAPT: work DB`.
   Set `PI_BOOST_DB_URL` for your DB (SQL Server via pyodbc, Oracle, Snowflake, ...). Databases
   without SQLAlchemy support (e.g. kdb) need that block replaced.
2. **Data Peek Python:** set `PI_BOOST_PYTHON` if the Python with pandas is not the one on PATH.
3. **Sharpener model:** if auto-pick doesn't find your gateway's Haiku, set `PI_BOOST_SHARPEN_MODEL`
   to the ID shown in `/model`.
4. **Auditor frontmatter:** `agents/auditor.md` uses the format of Pi's example subagent
   extension. Match your subagent format; the body carries over unchanged. Optionally uncomment
   `model:` with a work model ID. If Python has another name or the DB is only reachable through a
   client, add one line about it to its Rules section.
5. **Custom tool names:** if work has custom file-writing tools, add them to `MUTATING_TOOLS` in
   `extensions/done-gate.ts`. Custom shell tools go in `SHELL_TOOLS` in `extensions/output-trimmer.ts`.

Nothing else should need changing. If a Pi API is missing on an older version, the tool shows a
notice instead of crashing.

## Bring from work (to finish adapting)

- Exact `pi --version`
- Model IDs as shown in `/model` (especially Haiku 4.5)
- Database type and Python driver
- Frontmatter fields of an existing agent file (e.g. `explore`)

## Tests

All tests are in `test/` and use synthetic data only. Unit tests (free, run from the repo folder):
```powershell
node test/done-gate.test.ts; node test/hygiene-rules.test.ts; node test/hygiene-guard.test.ts
```
```powershell
node --import ./test/stub-pi.mjs test/prompt-sharpener.test.ts; node --import ./test/stub-pi.mjs test/output-trimmer.test.ts
```
```powershell
python test/test_hygiene_report.py; python test/test_profile.py
```
`test_profile.py` needs pandas, sqlalchemy and pyarrow (e.g. in a `.venv`); `python test/make_fixtures.py`
regenerates its data. Real-model scenarios (Git Bash, a few cents each on Haiku; `old` runs Pi 0.84 from a
local `.compat/` install): `test/run-scenario.sh`, `test/done_gate_rpc.py`, `test/auditor-test.sh`,
`test/cleanup_rpc.py` + `test/test_cleanup.py check`, and `test/sharpen-harness.ts` / `test/handoff-harness.ts`
loaded with `-e`. Usage is at the top of each script. In Git Bash, set `MSYS_NO_PATHCONV=1` before
`pi -p "/command …"`, or the `/command` argument is turned into a Windows path.

## Manual tests

Interactive parts that the scripts can't check. Start `pi` in any folder after installing:
1. **Done-Gate:** the status bar shows `gate ✓`. `alt+g` hides it ("Done-Gate off"), `alt+g` again brings it back.
2. **Done-Gate:** ask for a small file edit. You see one `[done-gate]` message, then a verification, then it stops.
3. **Sharpener:** type `pls fix teh chart its wrong` and press `alt+e`. A loader names the model, the editor
   gets a clean prompt, nothing is sent.
4. **Sharpener:** `alt+shift+e` brings the original back. `alt+e` again, then `ctrl+-`: the undo also reverts it.
5. **Sharpener:** `alt+e` then Esc right away: "Cancelled: draft unchanged".
6. **Sharpener:** `/sharpen whats the diffrence between act/360 and act/365` puts a clean question in the editor.
7. **Handoff:** after a short chat, `/handoff build the chart for USDJPY`. A loader, then an edit dialog,
   then a new session with the draft in the editor (not sent).
8. **Snippets:** copy them as described under [Install](#install), `/reload`, open the snippet menu. The three
   new ones show under append after your own, and toggling one adds its text after your prompt.
9. **Hygiene Guard:** in a git repo on `main`, ask Pi to change a file. The edit is blocked, and the agent
   creates a task branch and retries.
10. **Project Cleanup:** type `/skill:` and check that `project-cleanup` is offered.

## License

MIT. See `LICENSE`. `extensions/handoff.ts` is derived from Pi's MIT example extension
(attribution in the file).
