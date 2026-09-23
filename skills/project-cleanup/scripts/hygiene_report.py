"""Project hygiene report and comment-only verification for the project-cleanup skill.

Usage:
  python hygiene_report.py report <path>
  python hygiene_report.py verify-py <path> [--ref HEAD]
"""

import argparse
import ast
import importlib.util
import io
import re
import shutil
import subprocess
import sys
import tokenize
from pathlib import Path

SKIP_DIRS = {"node_modules", ".venv", "venv", ".git", "dist", "build", "__pycache__"}
LANGS = {".py": "python", ".js": "js", ".mjs": "js", ".cjs": "js", ".jsx": "js", ".ts": "js", ".tsx": "js",
         ".html": "html", ".htm": "html"}
AUTOLOADED = {"agents.md", "claude.md"}
MAX_LINES, MAX_CHARS = 200, 16_000
REPORT_CAP = 4096

TODO_RE = re.compile(r"\b(TODO|FIXME|XXX|HACK)\b")
CODE_RE = re.compile(
    r"^(def |class |return\b|import |from \S+ import|if .*:$|elif |else:|for .*:$|while .*:$|try:|except\b|print\(|"
    r"const |let |var |function\b|console\.|await |\}|\{$|<\w+[ >/])"
    r"|[;{]$|^[\w.\[\]'\"]+ ?[-+*/]?= ?\S|^\w+(\.\w+)*\(.*\)$"
)


def read_text(p: Path) -> str:
    return p.read_text(encoding="utf-8", errors="replace").replace("\r\n", "\n")


def iter_files(root: Path):
    # In a repo, gitignored files (local notes, build output) are not the project's problem.
    ls = git(root, "ls-files", "-co", "--exclude-standard", "-z")
    paths = [root / rel for rel in ls.stdout.split("\0") if rel] if ls.returncode == 0 else root.rglob("*")
    for p in sorted(paths):
        if p.is_file() and not any(part in SKIP_DIRS for part in p.relative_to(root).parts[:-1]):
            yield p


def py_comments(text: str) -> list[tuple[int, str]]:
    """(line, text) for every # comment and every docstring line."""
    out = []
    try:
        for tok in tokenize.generate_tokens(io.StringIO(text).readline):
            if tok.type == tokenize.COMMENT:
                out.append((tok.start[0], tok.string.lstrip("#").strip()))
    except (tokenize.TokenError, IndentationError, SyntaxError):
        out = [(i, ln.split("#", 1)[1].strip()) for i, ln in enumerate(text.split("\n"), 1) if ln.lstrip().startswith("#")]
    try:
        tree = ast.parse(text)
    except SyntaxError:
        return out
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and _docstring_node(node):
            d = node.body[0]
            for i, ln in enumerate(d.value.value.split("\n")):
                out.append((d.lineno + i, "doc:" + ln.strip()))
    return out


def js_comments(text: str) -> list[tuple[int, str]]:
    """(line, text) for // and /* */ comments. Skips string contents; regex literals are not handled."""
    out, i, n, line = [], 0, len(text), 1
    while i < n:
        c = text[i]
        if c == "\n":
            line += 1
        elif c in "'\"`":
            j = i + 1
            while j < n and text[j] != c:
                if text[j] == "\\":
                    j += 1
                elif text[j] == "\n":
                    line += 1
                    if c != "`":
                        break
                j += 1
            i = j
        elif text.startswith("//", i):
            j = text.find("\n", i)
            j = n if j < 0 else j
            out.append((line, text[i + 2:j].strip()))
            i = j - 1
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            j = n if j < 0 else j
            for k, ln in enumerate(text[i + 2:j].split("\n")):
                out.append((line + k, ln.strip().lstrip("*").strip()))
            line += text[i:j].count("\n")
            i = j + 1
        i += 1
    return out


def html_comments(text: str) -> list[tuple[int, str]]:
    out = []
    for m in re.finditer(r"<!--(.*?)-->", text, re.S):
        start = text.count("\n", 0, m.start()) + 1
        out += [(start + k, ln.strip()) for k, ln in enumerate(m.group(1).split("\n"))]
    for m in re.finditer(r"<script[^>]*>(.*?)</script>", text, re.S | re.I):
        offset = text.count("\n", 0, m.start(1))
        out += [(ln + offset, t) for ln, t in js_comments(m.group(1))]
    return out


COMMENT_FINDERS = {"python": py_comments, "js": js_comments, "html": html_comments}


def has_header(comments: list[tuple[int, str]], text: str) -> bool:
    """A comment/docstring block of 3+ lines at the top of the file (after shebang/encoding lines)."""
    lines = text.split("\n")
    first = next((i for i, ln in enumerate(lines, 1)
                  if ln.strip() and not ln.startswith("#!") and not re.match(r"#.*coding[:=]", ln)), None)
    if first is None:
        return False
    lines_with = {ln for ln, _ in comments}
    run = 0
    while first + run in lines_with or (first + run <= len(lines) and lines[first + run - 1].strip() in ('"""', "'''")):
        run += 1
    return run >= 3


def analyse_file(path: Path, lang: str) -> dict:
    text = read_text(path)
    comments = COMMENT_FINDERS[lang](text)
    plain = [t[4:] if t.startswith("doc:") else t for _, t in comments]
    return {
        "code_lines": sum(1 for ln in text.split("\n") if ln.strip()),
        "comment_lines": len({ln for ln, _ in comments}),
        "todo": sum(1 for t in plain if TODO_RE.search(t)),
        "commented_code": sum(1 for (_, raw), t in zip(comments, plain) if not raw.startswith("doc:") and CODE_RE.search(t)),
        "header": has_header(comments, text),
    }


def md_inventory(root: Path) -> list[tuple[str, int, int, bool]]:
    out = []
    for p in iter_files(root):
        if p.suffix.lower() == ".md":
            t = read_text(p)
            out.append((p.relative_to(root).as_posix(), len(t.rstrip("\n").split("\n")) if t else 0, len(t),
                        p.name.lower() in AUTOLOADED))
    return out


def tool_findings(root: Path) -> list[str]:
    lines = []
    excludes = ",".join(sorted(SKIP_DIRS))
    for name, args in (("ruff", ["check", "--select", "F401,F811,F841", "--output-format", "concise", "--exclude", excludes, str(root)]),
                       ("vulture", [str(root), "--min-confidence", "80", "--exclude", excludes])):
        cmd = [shutil.which(name)] if shutil.which(name) else ([sys.executable, "-m", name] if importlib.util.find_spec(name) else None)
        if not cmd:
            lines.append(f"{name}: not installed")
            continue
        r = subprocess.run(cmd + args, capture_output=True, text=True, encoding="utf-8", errors="replace")
        found = [ln for ln in r.stdout.splitlines() if re.match(r".+:\d+:", ln)]
        lines.append(f"{name}: {len(found)} findings")
    return lines


def build_report(root: Path) -> str:
    out = [f"# Hygiene report: {root.name}", "", "## md files (path, lines, chars)"]
    mds = md_inventory(root)
    out += [f"- {rel}  {ln} lines  {ch} chars{'  [auto-loaded]' if auto else ''}" for rel, ln, ch, auto in mds] or ["- none"]
    agents = next(((ln, ch) for rel, ln, ch, _ in mds if rel.lower() == "agents.md"), None)
    out.append(f"AGENTS.md: {'none' if not agents else f'{agents[0]}/{MAX_LINES} lines, {agents[1]}/{MAX_CHARS} chars'}"
               + (" OVER CAP" if agents and (agents[0] > MAX_LINES or agents[1] > MAX_CHARS) else ""))

    per_file, totals = {}, {}
    for p in iter_files(root):
        lang = LANGS.get(p.suffix.lower())
        if lang:
            per_file[p.relative_to(root).as_posix()] = r = analyse_file(p, lang)
            t = totals.setdefault(lang, {"files": 0, "code_lines": 0, "comment_lines": 0})
            t["files"] += 1
            t["code_lines"] += r["code_lines"]
            t["comment_lines"] += r["comment_lines"]
    out += ["", "## Code (non-blank lines, comment lines incl. docstrings, ratio)"]
    for lang, t in sorted(totals.items()):
        ratio = t["comment_lines"] / t["code_lines"] if t["code_lines"] else 0
        out.append(f"- {lang}: {t['files']} files, {t['code_lines']} lines, {t['comment_lines']} comment lines ({ratio:.0%})")
    out.append(f"TODO comments: {sum(r['todo'] for r in per_file.values())}; "
               f"files with header blocks: {sum(r['header'] for r in per_file.values())}; "
               f"commented-out-code-like lines: {sum(r['commented_code'] for r in per_file.values())}")

    out += ["", "## Top files by comment lines"]
    top = sorted(per_file.items(), key=lambda kv: -kv[1]["comment_lines"])[:15]
    out += [f"- {rel}  {r['comment_lines']}/{r['code_lines']}"
            + (f"  todo {r['todo']}" if r["todo"] else "") + (f"  code? {r['commented_code']}" if r["commented_code"] else "")
            + ("  header" if r["header"] else "") for rel, r in top if r["comment_lines"]] or ["- none"]
    out += ["", "## Tools"] + tool_findings(root)
    return cap_text("\n".join(out) + "\n")


def cap_text(text: str, cap: int = REPORT_CAP) -> str:
    if len(text.encode("utf-8")) <= cap:
        return text
    note = "\n... (truncated at 4 KB)\n"
    cut = text.encode("utf-8")[: cap - len(note)].decode("utf-8", errors="ignore")
    return cut[: cut.rfind("\n")] + note


def _docstring_node(node) -> bool:
    return bool(node.body) and isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant) \
        and isinstance(node.body[0].value.value, str)


def code_shape(source: str) -> str:
    """ast.dump with docstrings removed, so comment/docstring-only edits compare equal."""
    tree = ast.parse(source.replace("\r\n", "\n"))
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            if _docstring_node(node):
                node.body = node.body[1:]
            if len(node.body) == 1 and (isinstance(node.body[0], ast.Pass) or (
                    isinstance(node.body[0], ast.Expr) and isinstance(node.body[0].value, ast.Constant)
                    and node.body[0].value.value is Ellipsis)):
                node.body = []
    return ast.dump(tree)


def git(root: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, encoding="utf-8", errors="replace")


def verify_py(path: Path, ref: str) -> tuple[list[str], list[str]]:
    """Returns (checked files, files whose code changed) for .py files changed since ref."""
    top = git(path, "rev-parse", "--show-toplevel")
    if top.returncode:
        raise SystemExit(f"verify-py: {path} is not in a git repo")
    root = Path(top.stdout.strip())
    diff = git(root, "diff", "--name-only", ref, "--", str(path.resolve()))
    if diff.returncode:
        raise SystemExit(f"verify-py: git diff failed: {diff.stderr.strip()}")
    checked, changed = [], []
    for rel in diff.stdout.split():
        if not rel.endswith(".py") or any(part in SKIP_DIRS for part in Path(rel).parts):
            continue
        checked.append(rel)
        old, new_path = git(root, "show", f"{ref}:{rel}"), root / rel
        try:
            if old.returncode or not new_path.exists() or code_shape(old.stdout) != code_shape(read_text(new_path)):
                changed.append(rel)
        except SyntaxError:
            changed.append(rel + " (syntax error)")
    return checked, changed


def main(argv=None) -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("report").add_argument("path", type=Path)
    v = sub.add_parser("verify-py")
    v.add_argument("path", type=Path)
    v.add_argument("--ref", default="HEAD")
    a = ap.parse_args(argv)
    if not a.path.is_dir():
        print(f"not a folder: {a.path}", file=sys.stderr)
        return 2
    if a.cmd == "report":
        print(build_report(a.path.resolve()), end="")
        return 0
    checked, changed = verify_py(a.path, a.ref)
    if changed:
        print("verify-py: CODE CHANGED (not comment-only):\n" + "\n".join(f"- {c}" for c in changed))
        return 1
    print(f"verify-py: OK, {len(checked)} changed .py file(s), comment/docstring changes only")
    return 0


if __name__ == "__main__":
    sys.exit(main())
