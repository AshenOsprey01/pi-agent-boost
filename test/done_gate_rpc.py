"""Done-Gate RPC scenarios that -p mode cannot cover: abort mid-run, and toggle off.

Usage (repo root):  python test/done_gate_rpc.py <new|old>
Pass criteria printed at the end. Uses Haiku; costs a few cents at most.
"""

import json
import os
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
which = sys.argv[1] if len(sys.argv) > 1 else "new"
if which == "old":
    pi = [str(ROOT / ".compat/node_modules/.bin/pi.cmd")]
    model = "openrouter/~anthropic/claude-haiku-latest"
else:
    pi = [shutil.which("pi") or "pi"]
    model = "openrouter/anthropic/claude-haiku-4.5"

work = ROOT / "test/tmp/work"
shutil.rmtree(work, ignore_errors=True)
work.mkdir(parents=True)


def run(steps):
    """steps: list of (message, abort_after_write). Returns count of gate follow-ups."""
    proc = subprocess.Popen(
        pi + ["--mode", "rpc", "--no-session", "--no-extensions", "-e",
              str(ROOT / "extensions/done-gate.ts"), "--model", model],
        cwd=work, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", shell=False,
    )
    gates = 0
    settled = threading.Event()
    wrote = threading.Event()

    def reader():
        nonlocal gates
        for line in proc.stdout:
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t = e.get("type")
            if t == "message_end" and e["message"].get("role") == "user":
                if "[done-gate]" in json.dumps(e["message"].get("content")):
                    gates += 1
            elif t == "tool_execution_end" and e.get("toolName") in ("write", "edit"):
                wrote.set()
            elif t == "agent_settled":
                settled.set()

    threading.Thread(target=reader, daemon=True).start()

    def send(obj):
        proc.stdin.write(json.dumps(obj) + "\n")
        proc.stdin.flush()

    for i, (msg, abort_after_write) in enumerate(steps):
        settled.clear()
        wrote.clear()
        send({"id": f"p{i}", "type": "prompt", "message": msg})
        if msg.startswith("/"):
            time.sleep(3)  # commands do not start an agent run
            continue
        if abort_after_write:
            wrote.wait(120)
            time.sleep(0.5)
            send({"id": f"a{i}", "type": "abort"})
        settled.wait(180)
        time.sleep(3)  # give a (wrong) follow-up time to appear
    proc.stdin.close()
    proc.wait(30)
    return gates


abort_gates = run([(
    "Step 1: write a file a.txt containing 'x'. Step 2: then run the bash command "
    "`sleep 30` and wait for it. Do both.", True)])
toggle_gates = run([("/done-gate", False),
                    ("Write a file b.txt containing 'y'. Nothing else.", False)])

control_gates = run([("Write a file c.txt containing 'z'. Nothing else.", False)])
files = sorted(p.name for p in work.iterdir())

print(f"[{which}] files written: {files}")
print(f"[{which}] control (gate on) gate follow-ups = {control_gates} (expect 1)")
print(f"[{which}] abort scenario gate follow-ups = {abort_gates} (expect 0)")
print(f"[{which}] toggled-off scenario gate follow-ups = {toggle_gates} (expect 0)")
ok = control_gates == 1 and abort_gates == 0 and toggle_gates == 0 and {"a.txt", "b.txt", "c.txt"} <= set(files)
print("PASS" if ok else "FAIL")
