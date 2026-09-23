#!/usr/bin/env bash
# Auditor test: does the auditor catch a planted bug?
# Usage: test/auditor-test.sh <new|old> [clean]
#   new = global Pi (0.87.x), old = .compat Pi (0.84.x)
#   clean = also fix the bug first (control run: the auditor should PASS)
#
# Planted bug in test/fixtures/auditor/revenue_report.py: notional is converted to USD with
# `notional * rate` for every pair. EURUSD/GBPUSD notionals are in EUR/GBP, so that is right,
# but USDJPY notionals are already USD, so USDJPY revenue comes out ~150x too big.
#
# Setup (all inside test/tmp/audit-work, nothing in ~/.pi):
#   - copies the fixture + fx_trades.csv, runs the script to produce revenue_by_pair.csv
#   - copies agents/auditor.md to .pi/agents/ (the example's project scope)
#   - loads Pi's example subagent extension with -e for this run only
# The main agent (Haiku) calls the subagent tool; the auditor inherits Haiku.
set -euo pipefail
cd "$(dirname "$0")/.."
which_pi="$1"; mode="${2:-bug}"
if [[ "$which_pi" == old ]]; then
	PI="$PWD/.compat/node_modules/.bin/pi"; MODEL=openrouter/~anthropic/claude-haiku-latest
	SUB="$PWD/.compat/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts"
else
	PI="$(command -v pi)"; MODEL=openrouter/anthropic/claude-haiku-4.5
	SUB="$(npm root -g)/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts"
fi
work=test/tmp/audit-work
rm -rf "$work" && mkdir -p "$work/.pi/agents"
cp test/fixtures/fx_trades.csv test/fixtures/auditor/revenue_report.py "$work/"
cp agents/auditor.md "$work/.pi/agents/"
if [[ "$mode" == clean ]]; then
	# Control: convert only non-USD-base notionals.
	sed -i 's/^trades\["notional_usd"\] = .*/trades["notional_usd"] = trades["notional"].where(trades["notional_ccy"] == "USD", trades["notional"] * trades["rate"])/' "$work/revenue_report.py"
fi
(cd "$work" && ../../../.venv/Scripts/python revenue_report.py)

prompt='Call the subagent tool once with agent "auditor", agentScope "project", and this task:
"I changed revenue_report.py. It produces revenue_by_pair.csv (revenue in USD per ccy_pair, from fx_trades.csv). Check the numbers."
Then reply with only its verdict line.'
log="test/tmp/auditor-$which_pi-$mode.jsonl"
(cd "$work" && timeout 600 "$PI" --no-session --no-extensions -e "$SUB" --model "$MODEL" \
	--mode json -p "$prompt") > "$log" 2> "${log%.jsonl}.err" || true
node -e '
const lines=require("fs").readFileSync(process.argv[1],"utf8").split("\n").filter(Boolean);
let out="", tools=[], cost=0, sub="";
for (const l of lines) { let e; try { e=JSON.parse(l) } catch { continue }
  if (e.type==="tool_execution_start") tools.push(e.toolName);
  if (e.type==="tool_execution_end" && e.toolName==="subagent") {
    out=(e.result?.content||[]).map(c=>c.text).join("");
    const r=e.result?.details?.results?.[0]; if (r) { cost+=r.usage?.cost||0;
      sub=`child model=${r.model} turns=${r.usage?.turns} exit=${r.exitCode} tools=[${(r.messages||[]).flatMap(m=>(m.content||[]).filter(c=>c.type==="toolCall").map(c=>c.name)).join(",")}]`; } }
  if (e.type==="message_end" && e.message?.role==="assistant") cost+=e.message.usage?.cost?.total||0; }
console.log(`main tools=[${tools.join(",")}]`); console.log(sub);
console.log(`approx cost $${cost.toFixed(4)}`); console.log("---- auditor output (subagent tool result) ----"); console.log(out);
' "$log"
