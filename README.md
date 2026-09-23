# pi-agent-boost

Small, general-purpose [Pi](https://github.com/earendil-works/pi) tools that make the agent
produce better, more complete output while you type less, read less, and spend less.

No per-project setup, no context files to maintain. Every tool works with zero config.
Tested on Pi **0.84.4** and **0.87.1** (Windows 11).

## Tools

| Tool | Type | What it does | Details |
|---|---|---|---|
| Done-Gate | extension | After the agent edits files, sends it back **once** to prove the change works and finish leftovers | [docs/done-gate.md](docs/done-gate.md) |
| Data Peek | extension + Python | `data_peek` tool returns a compact (≤ 4 KB) profile of a file or SQL table/query, so the agent never guesses columns or units | [docs/data-peek.md](docs/data-peek.md) |
| Prompt Sharpener | extension | `alt+e` rewrites your editor draft into a clear prompt with a fast model. Never adds facts, never sends | [docs/prompt-sharpener.md](docs/prompt-sharpener.md) |
| Output Trimmer | extension | Caps large `bash`/`powershell` outputs at ~6 KB for the model and points to the full output file | [docs/output-trimmer.md](docs/output-trimmer.md) |
| Handoff | extension | `/handoff <next task>` opens a new session with a drafted, focused prompt from the live conversation | [docs/handoff.md](docs/handoff.md) |
| Auditor | subagent definition | Read-only, fresh-context numbers checker: recomputes key figures, checks FX/Rates traps | [docs/auditor.md](docs/auditor.md) |
| Hygiene Rules | extension | Adds short project-hygiene rules (comments, one AGENTS.md, temporary PLAN/TODO, task branches) to every session | [Project hygiene](#project-hygiene) |
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

## Project hygiene

Agents tend to fill projects with comments that restate the code and with md files (PLAN, TODO,
DECISIONS, CHANGELOG...) that go stale and mislead the next agent. These parts keep a project at
one short `AGENTS.md` plus code with only WHY comments.

**Hygiene Rules** (`extensions/hygiene-rules.ts`) appends a ~1.5 KB rule block to the system prompt
of every turn: comment only WHY / business rules / warnings, the only lasting md file is `AGENTS.md`
(max 200 lines / 16,000 characters), PLAN.md and TODO.md are temporary, one place per fact, remove
dead code, and work on a task branch instead of main. Pi packages cannot ship an AGENTS.md, so the
rules come from an extension.

## Adapting at work (ADAPT checklist)

Every work-specific spot is marked `ADAPT:` in the code. In order of likelihood:

1. **Data Peek DB connection:** `extensions/data-peek/profile.py`, block marked `# ADAPT: work DB`.
   Set `PI_BOOST_DB_URL` for your DB (SQL Server via pyodbc, Oracle, Snowflake, ...). Databases
   without SQLAlchemy support (e.g. kdb) need that block replaced.
2. **Data Peek Python:** set `PI_BOOST_PYTHON` if the Python with pandas is not the one on PATH.
3. **Sharpener model:** if auto-pick doesn't find your gateway's Haiku, set `PI_BOOST_SHARPEN_MODEL`
   to the ID shown in `/model`.
4. **Auditor frontmatter:** `agents/auditor.md` uses the format of Pi's example subagent
   extension. Match your subagent format. Optionally uncomment `model:` with a work model ID.
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

All tests are in `test/` and use synthetic data only. See the "Tested" section of each page in
`docs/` for how to run them.

## License

MIT. See `LICENSE`. `extensions/handoff.ts` is derived from Pi's MIT example extension
(attribution in the file).
