"""Drive the project-cleanup skill on the messy fixture over RPC, answering OK at every pause.

Usage (repo root):  python test/cleanup_rpc.py <new|old> [model]
Loads the whole package (rules, guard, done-gate, skill). Then run: python test/test_cleanup.py check
Transcript: test/tmp/cleanup-<new|old>.log
"""

import json
import os
import shutil
import subprocess
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "test"))
import test_cleanup as tc  # noqa: E402

which = sys.argv[1] if len(sys.argv) > 1 else "new"
if which == "old":
    pi = [str(ROOT / ".compat/node_modules/.bin/pi.cmd")]
    model = "openrouter/~anthropic/claude-haiku-latest"
else:
    pi = [shutil.which("pi") or "pi"]
    model = "openrouter/anthropic/claude-haiku-4.5"
model = sys.argv[2] if len(sys.argv) > 2 else model
MAX_TURNS = 16
FIRST_REPLY = "Only for me: AGENTS.md only, no README. OK."
REPLY = "OK, approved. Continue."

tc.setup()
env = {**os.environ, "PATH": str(ROOT / ".venv/Scripts") + os.pathsep + os.environ["PATH"]}
proc = subprocess.Popen(pi + ["--mode", "rpc", "--no-session", "--no-extensions", "-e", str(ROOT), "--model", model],
                        cwd=tc.WORK, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                        text=True, encoding="utf-8", env=env)
log = open(ROOT / f"test/tmp/cleanup-{which}.log", "w", encoding="utf-8")
settled = threading.Event()
cost = 0.0


def reader():
    global cost
    for line in proc.stdout:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get("type")
        if t == "message_end":
            m = e["message"]
            text = " ".join(c.get("text", "") for c in m.get("content", []) if isinstance(c, dict) and c.get("type") == "text")
            if m.get("role") == "assistant":
                cost += (m.get("usage") or {}).get("cost", {}).get("total", 0) or 0
            log.write(f"\n--- {m.get('role')}: {text}\n")
        elif t == "tool_execution_start":
            log.write(f"  tool {e.get('toolName')}: {json.dumps(e.get('args'))[:200]}\n")
        elif t == "tool_execution_end" and e.get("isError"):
            log.write(f"  ERROR: {json.dumps(e.get('result'))[:300]}\n")
        elif t == "agent_settled":
            settled.set()
        log.flush()


def done():
    branch = tc.git("branch", "--show-current").strip()
    return branch in ("main", "master") and "cleanup: remove dead code" in tc.git("log", "--format=%s")


threading.Thread(target=reader, daemon=True).start()
msg = "/skill:project-cleanup"
for turn in range(MAX_TURNS):
    settled.clear()
    proc.stdin.write(json.dumps({"id": f"t{turn}", "type": "prompt", "message": msg}) + "\n")
    proc.stdin.flush()
    if not settled.wait(900):
        print(f"turn {turn}: timed out")
        break
    print(f"turn {turn} settled, cost so far ${cost:.3f}, branch {tc.git('branch', '--show-current').strip()}")
    if done():
        break
    msg = FIRST_REPLY if turn == 0 else REPLY
proc.stdin.close()
proc.wait(30)
print(f"finished={done()} total cost ${cost:.3f}")
