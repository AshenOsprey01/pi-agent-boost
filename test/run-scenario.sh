#!/usr/bin/env bash
# Run one cheap Pi scenario in JSON mode and summarise the events.
# Usage: test/run-scenario.sh <new|old> <extension path> "<prompt>" [extra pi args...]
#   new = global Pi (0.87.x), old = .compat Pi (0.84.x)
# Prints: user messages (with [done-gate] marker), tool calls, final stopReason.
# Full JSON log goes to test/tmp/last-<new|old>.jsonl
set -euo pipefail
cd "$(dirname "$0")/.."
which_pi="$1"; ext="$2"; prompt="$3"; shift 3
if [[ "$which_pi" == old ]]; then
	PI="$PWD/.compat/node_modules/.bin/pi"; MODEL=openrouter/~anthropic/claude-haiku-latest
else
	PI="$(command -v pi)"; MODEL=openrouter/anthropic/claude-haiku-4.5
fi
mkdir -p test/tmp/work
log="test/tmp/last-$which_pi.jsonl"
(cd test/tmp/work && timeout 240 "$PI" --no-session --no-extensions -e "$OLDPWD/$ext" \
	--model "$MODEL" --mode json "$@" -p "$prompt") > "$log" 2> "test/tmp/last-$which_pi.err" || true
node -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
let gates=0, tools=[], users=0, last="";
for (const l of lines) { let e; try { e=JSON.parse(l) } catch { continue }
  if (e.type==="message_end" && e.message?.role==="user") { users++;
    const t=JSON.stringify(e.message.content); if (t.includes("[done-gate]")) gates++; }
  if (e.type==="tool_execution_start") tools.push(e.toolName);
  if (e.type==="message_end" && e.message?.role==="assistant") last=e.message.stopReason; }
console.log(`user msgs=${users} gate follow-ups=${gates} tools=[${tools.join(",")}] last stopReason=${last}`);
' "$log"
