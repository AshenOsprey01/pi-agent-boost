# Prompt Sharpener

**File:** `extensions/prompt-sharpener.ts`

## Why
Writing long, clear prompts is slow, and typos and vague wording lower output quality. The
Sharpener rewrites your rough draft into a clean prompt with a fast, cheap model. You review it
and press Enter yourself.

## How to use
| Action | Effect |
|---|---|
| Type a draft, press **`alt+e`** | The draft is rewritten in place (Esc cancels while it runs) |
| `/sharpen <draft text>` | Same, with the draft given as text (typing a command submits the editor, so the draft goes in the argument) |
| **`alt+shift+e`** or `/unsharpen` | Puts your original draft back |
| **`ctrl+-`** | The editor's own undo also reverts the rewrite (Pi's undo key is `ctrl+-`, not `ctrl+z`) |

It never sends anything by itself. It runs only in the interactive TUI.

## What it sends to the model
The draft, the last user/assistant exchange (≤ about 3,000 characters, only so "it"/"that" can
be resolved), and the cwd folder name. Nothing else. A rewrite costs about $0.001 on Haiku 4.5.

## Rules the model follows (system prompt)
- Keep intent, voice, language, and every piece of information, **including hunches**
  ("i think its the join" → "I suspect the join is the cause").
- **Never invent** facts, file names, columns, numbers, libraries, or locations. Code, paths,
  identifiers, and quoted text stay verbatim.
- Short drafts stay short. Three or more requirements → `Goal / Context / Constraints / Done when`.
- `Open questions:` only for decisions that only you can make (never for things the agent can look up).
- No filler, no preamble.

Examples (Haiku 4.5):
```
draft:  pls fix teh revenue chart it shows wrong totals for usdjpy i think its the join in rev_by_desk.sql?? also make the y axis in bps not %
result: Fix the revenue chart. I suspect the join in rev_by_desk.sql is causing wrong totals for USDJPY. Change the y-axis from % to bps.

draft:  add a test for the parse_date funtion
result: Add a test for the parse_date function.
```

## Model choice (zero config)
1. `PI_BOOST_SHARPEN_MODEL="provider/modelId"` if set and found.
2. Otherwise the newest available model whose id contains `haiku` (it skips `:batch` variants and
   ranks `…-latest` aliases last, because on OpenRouter that alias was an older, weaker Haiku).
3. Otherwise the current session model.

The loader shows which model was picked and why. The final notice shows the cost when the provider reports it.

## ADAPT points
- At work, if auto-pick doesn't find Haiku 4.5 on the gateway, set
  `PI_BOOST_SHARPEN_MODEL` to its id as shown in `/model` (format `provider/modelId`).

## Tested
`test/prompt-sharpener.test.ts` (model ranking, context truncation, output cleaning).
`test/sharpen-harness.ts` runs the real model call in print mode on 0.84.4 and 0.87.1. Errors
(e.g. a 404 from the provider) are reported, not swallowed. Shortcuts and the loader need a
manual check (see TODO.md).
