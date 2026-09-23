"""Outcome check for the project-cleanup skill on the messy fixture.

  python test/test_cleanup.py setup   copy test/fixtures/messy-project to test/tmp/messy as a fresh git repo
  python test/test_cleanup.py check   assert the cleaned result (run after the skill finished)
"""

import os
import re
import shutil
import stat
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURE = ROOT / "test/fixtures/messy-project"
WORK = ROOT / "test/tmp/messy"
sys.path.insert(0, str(ROOT / "skills/project-cleanup/scripts"))
import hygiene_report as hr  # noqa: E402

# (file, pattern) that must still be in a comment: WHY / business rule / warning / moved local fact.
MUST_SURVIVE = [
    ("fxdash/loader.py", r"T\+2"),
    ("fxdash/revenue.py", r"abs|sign"),
    ("fxdash/chart_prep.py", r"(?i)reorder|position"),
    ("web/dashboard.js", r"100"),
    ("fxdash/pricing.py", r"JPY"),  # moved from DEFINITIONS.md
]
# (file, text) planted noise that must be gone.
MUST_GO = [
    ("fxdash/loader.py", "Author:"), ("fxdash/loader.py", "loop over rows"), ("fxdash/loader.py", "return the result"),
    ("fxdash/loader.py", "TODO"), ("fxdash/loader.py", "value_date = trade_date + timedelta"),
    ("fxdash/loader.py", "import json"),
    ("fxdash/revenue.py", "returns revenue in EUR"), ("fxdash/revenue.py", "total = total * 100"),
    ("fxdash/revenue.py", "This module contains"), ("fxdash/revenue.py", "calculate bps"),
    ("fxdash/pricing.py", "legacy_mid_price"), ("fxdash/pricing.py", "import math"),
    ("fxdash/chart_prep.py", "print(rows)"), ("fxdash/chart_prep.py", "This file prepares"),
    ("web/api.js", "Written by"), ("web/dashboard.js", "TODO"), ("web/dashboard.js", "console.log"),
    ("web/dashboard.js", "oldFormatter"), ("web/index.html", "old-chart"), ("web/index.html", "page title"),
]
AGENTS_MUST = [r"USD", r"bps", r"unittest", r"run\.py"]
AGENTS_MUST_NOT = [r"[├└]", r"legacy_mid_price", r"(?i)\buse[sd]? pandas|pandas (for|to|chosen|is)", r"Always update PLAN", r"(?i)largest first|descending"]


def git(*args, cwd=WORK):
    return subprocess.run(["git", "-C", str(cwd), *args], capture_output=True, text=True, encoding="utf-8").stdout


def _rm_readonly(func, path, _exc):
    os.chmod(path, stat.S_IWRITE)
    func(path)


def setup():
    if WORK.exists():
        shutil.rmtree(WORK, onexc=_rm_readonly)
    shutil.copytree(FIXTURE, WORK)
    git("init", "-q", "-b", "main")
    git("add", ".")
    git("-c", "user.name=fixture", "-c", "user.email=fixture@example.com", "commit", "-qm", "initial messy project")
    print(f"ready: {WORK}")


failures = 0


def check(name, cond, info=""):
    global failures
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n    {str(info)[:300]}"))
    failures += 0 if cond else 1


def comments_of(rel):
    p = WORK / rel
    return " | ".join(t for _, t in hr.COMMENT_FINDERS[hr.LANGS[p.suffix]](hr.read_text(p))) if p.exists() else ""


def run_check():
    mds = sorted(rel for rel in git("ls-files", "-co", "--exclude-standard").split("\n") if rel.lower().endswith(".md"))
    check("only AGENTS.md left", mds == ["AGENTS.md"], mds)
    agents = hr.read_text(WORK / "AGENTS.md") if (WORK / "AGENTS.md").exists() else ""
    check("AGENTS.md within caps", 0 < len(agents) <= hr.MAX_CHARS and len(agents.split("\n")) <= hr.MAX_LINES, len(agents))
    for pat in AGENTS_MUST:
        check(f"AGENTS.md has /{pat}/", re.search(pat, agents), agents)
    for pat in AGENTS_MUST_NOT:
        check(f"AGENTS.md lacks /{pat}/", not re.search(pat, agents), re.search(pat, agents))

    for rel, pat in MUST_SURVIVE:
        check(f"comment survives: {rel} /{pat}/", re.search(pat, comments_of(rel)), comments_of(rel))
    for rel, text in MUST_GO:
        check(f"gone: {rel} {text!r}", text not in hr.read_text(WORK / rel))
    defs = [p.name for p in (WORK / "fxdash").glob("*.py") if "def round_bps" in hr.read_text(p)]
    check("duplicate round_bps merged", len(defs) == 1, defs)

    r = subprocess.run([sys.executable, "-m", "compileall", "-q", "."], cwd=WORK, capture_output=True, text=True)
    check("compileall ok", r.returncode == 0, r.stdout + r.stderr)
    r = subprocess.run([sys.executable, "-m", "unittest", "discover", "-s", "tests"], cwd=WORK, capture_output=True, text=True)
    check("project tests pass", r.returncode == 0, r.stderr[-300:])
    r = subprocess.run([sys.executable, "run.py"], cwd=WORK, capture_output=True, text=True)
    check("entry point run.py still works", r.returncode == 0 and "desk total bps: 20.04" in r.stdout, r.stdout + r.stderr)

    log = git("log", "--all", "--format=%H %s")
    comment_commits = [ln.split(" ", 1) for ln in log.splitlines() if ln.split(" ", 1)[1].startswith("cleanup: comments")]
    check("has cleanup: comments commit(s)", comment_commits, log)
    for sha, subject in comment_commits:
        changed = [f for f in git("diff", "--name-only", f"{sha}^", sha).split() if f.endswith(".py")]
        bad = [f for f in changed if hr.code_shape(git("show", f"{sha}^:{f}")) != hr.code_shape(git("show", f"{sha}:{f}"))]
        check(f"comment-only: {subject}", not bad, bad)
    for subject in ("cleanup: merge md files into AGENTS.md", "cleanup: remove dead code"):
        check(f"commit {subject!r}", subject in log, log)
    check("cleanup/* branch exists", re.search(r"cleanup/", git("branch", "--list")), git("branch", "--list"))
    check("working tree clean", git("status", "--porcelain").strip() == "", git("status", "--porcelain"))
    check("progress file removed", not (WORK / ".git/cleanup-todo.txt").exists())
    check("no build artifacts committed", "__pycache__" not in git("ls-files"), git("ls-files"))
    print(f"\n{'ALL PASS' if not failures else f'{failures} FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    cmd = sys.argv[1] if len(sys.argv) > 1 else "check"
    sys.exit(setup() if cmd == "setup" else run_check())
