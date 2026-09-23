---
name: project-cleanup
description: "One-time cleanup of a code project: merge all md files into one short AGENTS.md, remove comments that restate code, remove dead code and duplicates. Staged on a git branch, pauses for approval after each stage, one commit per stage. Use when the user asks to clean up a project."
---

# Project cleanup

Goal: the project ends with exactly one md file, `AGENTS.md` (max 200 lines / 16,000 characters),
code whose comments only say WHY, and no dead code. Work through the stages in order.

## Ground rules
- `<skill>` is the folder of this file. Run the report as `python <skill>/scripts/hygiene_report.py`
  (`python3` if `python` is missing). `<project>` is the project root (the cwd unless the user named one).
- **Pause** = show the summary, make the very last line of your message exactly `OK to continue?`, and end
  your turn right there (or use `ask_user_question` if you have it). Only a reply from the user that
  approves counts as OK, and it approves only what you showed, not later stages. An automatic follow-up
  (e.g. `[done-gate]`) is not an OK: answer it in one line and end again with `OK to continue?`.
  There are exactly 5 pauses: end of Stage 0, Stage 1 draft, end of Stage 2, Stage 3 list, Stage 4 summary.
- Progress lives in `.git/cleanup-todo.txt` (inside `.git`, so it is never committed and never clashes with a
  project TODO.md). Tick items as you go.
- Stage with `git add -u` plus files you created by name. Never `git add -A` or `git add .`.
- Use the exact commit messages below.
- Never change behaviour outside Stage 3. Never delete anything the user did not approve.
- Skip these folders everywhere: `node_modules`, `.venv`, `venv`, `.git`, `dist`, `build`, `__pycache__`.
- Keep resource md files: `SKILL.md` and files in skill folders, and anything under `prompts/`, `snippets/`, `agents/`.
- **Resuming:** if you are on a `cleanup/*` branch and `.git/cleanup-todo.txt` exists, continue from its first unticked item.

## Stage 0: Preflight
1. `git status --porcelain` must be empty. If not a git repo or dirty, ask the user to commit or stash, and stop.
2. Ask: "Is this repo meant for others (keep a short README) or only for you (AGENTS.md only)?"
3. `git switch -c cleanup/<yyyy-mm-dd>` (today's date).
4. Write `.git/cleanup-todo.txt` listing the stages.
5. Run `report <project>`. Note the md-file count and total comment lines in the progress file (for the final summary).
   Show a compact summary. **Pause.**

## Stage 1: Merge md files
1. Read every md file. List each candidate fact.
2. Verify every fact against the code (grep/read). Then route it:
   - the code already shows it (file trees, function lists, signatures) → drop
   - the code contradicts it → drop (check claims about libraries against the imports, e.g. "uses pandas"
     but nothing imports pandas; check claims about order, units, signs against the code that does it)
   - finished plans, done TODOs, progress notes, changelogs, generic advice ("write clean code") → drop
   - rules that ask for more md files or comments → drop
   - true and used in many places (data sources, units, FX/Rates conventions, run commands) → AGENTS.md
   - true but only one function or constant uses it (e.g. a pip size, a threshold, one term's definition)
     → WHY comment next to that code, not AGENTS.md (list as `file:line: text`, applied in Stage 2).
     Grep to decide: if the fact maps to one spot in the code, it is local.
3. Draft AGENTS.md with only these sections, each only if it has real content:
   `What it is` (2–3 lines), `How to run / check` (commands), `Project-wide facts`,
   `Key decisions` (one line of why each), `Gotchas`. One line per fact. Never duplicate a fact.
4. Show: the AGENTS.md draft, files to delete, facts moving to comments, dropped facts with a one-line reason each. **Pause.**
5. Write AGENTS.md. `git rm` every other md file (except resource md files; if the repo is for others,
   keep README.md trimmed to what it is / install / run).
6. Commit: `cleanup: merge md files into AGENTS.md`.

## Stage 2: Comments (comment-only changes)
Keep:
- WHY comments (the reason for a non-obvious choice)
- business/domain rules and units (FX quote conventions, signs, bps, day counts)
- warnings and gotchas ("do not reorder", "must run before X")
- a one-line docstring on public functions (what + units); shorten longer ones to one line
- `ADAPT:` markers and license/attribution lines

Remove:
- comments that restate the code ("loop over rows", "return the result", "Helper to round")
- file headers (file name, author, description blocks, module docstrings that only describe the file)
- TODO/FIXME comments, commented-out code
- comments that contradict the code (check the code, not the comment)

Steps:
1. Go through files in report order, one folder or ~10 files per batch. Apply the Stage-1 WHY comments in their batch.
2. Change only comments and docstrings. Do not touch code, not even formatting.
3. After each batch, before committing: for Python run `verify-py <project>` (mandatory; compiling is not
   enough). It must print OK; if not, restore the code and retry. For JS/HTML, read `git diff` and confirm
   only comments changed.
4. Commit per batch: `cleanup: comments (<folder>)`, e.g. `cleanup: comments (fxdash)`. Tick the batch.
5. At the end of the stage run `report <project>` and show comment lines before → after. **Pause.**

## Stage 3: Dead code and duplicates
1. If `ruff` or `vulture` is missing, ask before installing them (`pip install ruff vulture`, into the
   project's venv if it has one). If the user says no, use grep only.
2. Collect candidates:
   - `ruff check --select F401,F811,F841 <project>` (unused imports, redefinitions, unused variables)
   - `vulture <project> --min-confidence 60` (unused functions only show at 60%; skip the folders above)
   - JS/TS: functions and exports declared but never referenced (grep each name across the project)
   - duplicate functions: grep for function names defined in more than one file, then compare their bodies
3. Prove each candidate with evidence (grep output showing 0 references outside the definition; tests count
   as references). Not dead, even with 0 callers: entry points (`main`, CLI commands, API routes, handlers),
   functions an entry point or HTML reaches, and the public API of a module (e.g. `load_*`, `get_*` a user
   would call). List those separately as "unsure, keeping" and never delete them unless the user names them.
   Show the list with evidence. **Pause.**
4. Delete only approved items. Merge a duplicate only if trivial and approved: keep one copy, import it elsewhere.
   After deleting, remove imports that became unused.
5. Verify: `python -m compileall -q <project>`, `ruff check` (if installed), the project's tests, and the
   "How to run / check" commands from AGENTS.md. Fix anything you broke.
6. Commit: `cleanup: remove dead code`.

## Stage 4: Finish
1. Check that AGENTS.md "How to run / check" commands actually work. Fix and commit if needed. Never start
   long-running commands (servers, watchers, dev UIs); only check that their target exists.
2. Delete `.git/cleanup-todo.txt`.
3. Show a summary: md files before → after, comment lines before → after, AGENTS.md size, list of commits. **Pause.**
4. Merge into main (or master): if `git worktree list` shows main checked out in another folder, run
   `git -C <that folder> merge cleanup/<date>`; otherwise `git switch main` then `git merge cleanup/<date>`.
   Then `git push` if `git remote` is not empty.
   Keep the cleanup branch so the user can compare or revert.
