# pi-agent-boost

Small, general-purpose [Pi](https://github.com/earendil-works/pi) tools that make the agent
produce better, more complete output while you type less and spend less.

> Status: work in progress. See `TODO.md`.

## Install

```powershell
pi install git:github.com/AshenOsprey01/pi-agent-boost
```

Then run `/reload` in Pi (or restart it).

## Tools

| Tool | Type | What it does |
|---|---|---|
| Done-Gate | extension | After the agent edits files, sends it back once to prove it works and finish leftovers |
| Prompt Sharpener | extension | `alt+e` rewrites your editor draft into a clear prompt with a fast model |
| Data Peek | extension + Python | `data_peek` tool returns a compact profile of a file or SQL table/query |
| Output Trimmer | extension | Caps large `bash` outputs and saves the full output to a temp file |
| Handoff | extension | `/handoff <next task>` starts a new session with a drafted, focused prompt |
| Auditor | subagent definition | Read-only, fresh-context numbers checker with FX/Rates traps |
| Snippets | `.md` files | Show evidence · Finish everything · Number hygiene |

Details for each tool live in `docs/`.

## Configuration

No config files. Every tool works with zero config. Optional environment variables all start
with `PI_BOOST_` (table to follow).

## Adapting at work

Work-specific details are marked `ADAPT:` in the code (checklist to follow).

## License

MIT. See `LICENSE`.
