"""Run: python test/test_hygiene_report.py  (stdlib only; uses a temp folder)"""

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "skills/project-cleanup/scripts"))
import hygiene_report as hr  # noqa: E402

failures = 0


def check(name, cond, info=""):
    global failures
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n    {str(info)[:400]}"))
    failures += 0 if cond else 1


PY = '''"""Module header line one.
Line two.
Line three.
"""
import os  # why: os is needed


def f(x):
    """One-line doc."""
    # TODO: speed up
    # return x * 2
    s = "# not a comment"
    return x  # trailing
'''
c = hr.py_comments(PY)
texts = [t for _, t in c]
check("py: # comments found", "why: os is needed" in texts and "trailing" in texts, texts)
check("py: string '#' ignored", not any("not a comment" in t for t in texts), texts)
check("py: docstrings counted", "doc:One-line doc." in texts and "doc:Line two." in texts, texts)
tmp = Path(tempfile.mkdtemp(prefix="hyg-"))
(tmp / "m.py").write_bytes(PY.replace("\n", "\r\n").encode())
a = hr.analyse_file(tmp / "m.py", "python")
check("py: CRLF ok, todo + commented code + header", a["todo"] == 1 and a["commented_code"] == 1 and a["header"], a)

JS = """// File: dashboard.js
// Renders the dashboard
// Author: someone
const url = "http://example.com"; // endpoint
/* block
   comment */
// const old = 1;
let s = 'it\\'s // fine';
"""
jc = hr.js_comments(JS)
check("js: // and /* */ found, strings skipped",
      [t for _, t in jc] == ["File: dashboard.js", "Renders the dashboard", "Author: someone", "endpoint", "block", "comment",
                             "const old = 1;"], jc)
check("js: line numbers", [ln for ln, _ in jc] == [1, 2, 3, 4, 5, 6, 7], jc)
(tmp / "d.js").write_text(JS)
a = hr.analyse_file(tmp / "d.js", "js")
check("js: header + commented code", a["header"] and a["commented_code"] == 1, a)

HTML = "<html>\n<!-- nav bar -->\n<script>\n// init chart\nlet x = 1;\n</script>\n</html>\n"
check("html: <!-- --> and script comments", hr.html_comments(HTML) == [(2, "nav bar"), (4, "init chart")], hr.html_comments(HTML))

check("comment heuristics: prose is not code",
      not any(hr.CODE_RE.search(s) for s in ["keep this order: settlement depends on it", "return the result", "import the dashboard"]))
check("comment heuristics: code is code", all(hr.CODE_RE.search(s) for s in ["x = compute(y)", "print(total)", "return x", "foo.bar(1)", "import os", "from a import b", "console.log(rows);"]))

# md inventory and skip dirs
(tmp / "AGENTS.md").write_text("a\n" * 250)
(tmp / "notes").mkdir()
(tmp / "notes/progress.md").write_text("p\n")
(tmp / "node_modules/pkg").mkdir(parents=True)
(tmp / "node_modules/pkg/README.md").write_text("skip")
(tmp / "node_modules/pkg/x.js").write_text("// skip")
inv = hr.md_inventory(tmp)
check("md inventory skips node_modules", [i[0] for i in inv] == ["AGENTS.md", "notes/progress.md"], inv)
check("md inventory flags AGENTS.md auto-loaded", inv[0] == ("AGENTS.md", 250, 500, True), inv)
rep = hr.build_report(tmp)
check("report: AGENTS.md over cap", "250/200 lines" in rep and "OVER CAP" in rep, rep)
check("report: languages", "- python: 1 files" in rep and "- js: 1 files" in rep, rep)
check("report: <= 4 KB", len(rep.encode()) <= 4096)
check("report: tools line", "ruff:" in rep and "vulture:" in rep, rep)
big = hr.cap_text("line\n" * 2000)
check("cap_text truncates with note", len(big.encode()) <= 4096 and big.endswith("(truncated at 4 KB)\n"))

# code_shape / verify-py
check("code_shape: comments + docstrings ignored",
      hr.code_shape(PY) == hr.code_shape('import os\ndef f(x):\n    s = "# not a comment"\n    return x\n'))
check("code_shape: code change detected", hr.code_shape("x = 1\n") != hr.code_shape("x = 2\n"))
check("code_shape: docstring-only body == pass", hr.code_shape('def f():\n    """d"""\n') == hr.code_shape("def f():\n    pass\n"))

repo = tmp / "repo"
repo.mkdir()
g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True)  # noqa: E731
g("init", "-q")
(repo / "a.py").write_text(PY)
(repo / "b.py").write_text("y = 1\n")
g("add", ".")
g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init")
(repo / "a.py").write_text(PY.replace("    # TODO: speed up\n", "").replace('"""One-line doc."""', '"""Better doc."""'))
checked, changed = hr.verify_py(repo, "HEAD")
check("verify-py: comment-only change passes", checked == ["a.py"] and changed == [], (checked, changed))
(repo / "b.py").write_text("y = 2\n")
checked, changed = hr.verify_py(repo, "HEAD")
check("verify-py: code change fails", changed == ["b.py"], (checked, changed))
r = subprocess.run([sys.executable, str(ROOT / "skills/project-cleanup/scripts/hygiene_report.py"), "verify-py", str(repo)],
                   capture_output=True, text=True)
check("verify-py CLI exits 1 on code change", r.returncode == 1 and "b.py" in r.stdout, r.stdout + r.stderr)

subprocess.run(["cmd", "/c", "rmdir", "/s", "/q", str(tmp)] if sys.platform == "win32" else ["rm", "-rf", str(tmp)])
print(f"\n{'ALL PASS' if not failures else f'{failures} FAILED'}")
sys.exit(1 if failures else 0)
