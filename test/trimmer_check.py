"""Inspect the last JSON-mode log: size of each tool result the MODEL saw, and verify
that any output-trimmer path exists and holds more than the model got.
Usage: python test/trimmer_check.py test/tmp/last-new.jsonl
"""

import json
import os
import re
import sys

for line in open(sys.argv[1], encoding="utf-8"):
    try:
        e = json.loads(line)
    except ValueError:
        continue
    m = e.get("message") or {}
    if e.get("type") == "message_end" and m.get("role") == "toolResult":
        text = "".join(c.get("text", "") for c in m.get("content", []) if c.get("type") == "text")
        note = re.search(r"full output: (.+?) — use read", text)
        info = ""
        if note:
            p = note.group(1)
            info = f" path_exists={os.path.exists(p)} file_bytes={os.path.getsize(p) if os.path.exists(p) else 0}"
        piote = "yes" if "[Showing" in text else "no"
        print(f"{m.get('toolName')}: model saw {len(text.encode())} bytes, trimmer_note={'yes' if note else 'no'}, pi_note={piote}{info}")
