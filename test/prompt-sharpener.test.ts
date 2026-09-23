// Unit tests for Prompt Sharpener's pure helpers. Run: node test/prompt-sharpener.test.ts
import assert from "node:assert/strict";
import { buildUserMessage, cleanOutput, lastExchange, pickModel } from "../extensions/prompt-sharpener.ts";

const m = (provider: string, id: string) => ({ provider, id });
const home = [
	m("openrouter", "anthropic/claude-opus-5"),
	m("openrouter", "anthropic/claude-3-haiku"),
	m("openrouter", "anthropic/claude-haiku-4.5"),
	m("openrouter", "anthropic/claude-haiku-4.5:batch"),
];
const cur = home[0];
const find = (list: typeof home) => (p: string, id: string) => list.find((x) => x.provider === p && x.id === id);

// Newest haiku, skipping :batch.
assert.equal(pickModel(home, cur, undefined, find(home)).model?.id, "anthropic/claude-haiku-4.5");
// "latest" alias ranks below versioned models, but is used if it's the only haiku.
const withLatest = [...home, m("openrouter", "~anthropic/claude-haiku-latest")];
assert.equal(pickModel(withLatest, cur, undefined, find(withLatest)).model?.id, "anthropic/claude-haiku-4.5");
const onlyLatest = [cur, m("openrouter", "~anthropic/claude-haiku-latest")];
assert.equal(pickModel(onlyLatest, cur, undefined, find(onlyLatest)).model?.id, "~anthropic/claude-haiku-latest");
// Date stamps don't outrank versions: haiku-4-5-20251001 vs 3-5-haiku-20241022.
const dated = [m("gw", "claude-3-5-haiku-20241022"), m("gw", "claude-haiku-4-5-20251001")];
assert.equal(pickModel(dated, undefined, undefined, find(dated)).model?.id, "claude-haiku-4-5-20251001");
// Env override wins when found; ignored (falls back) when not found.
assert.equal(pickModel(home, cur, "openrouter/anthropic/claude-3-haiku", find(home)).model?.id, "anthropic/claude-3-haiku");
const r = pickModel(home, cur, "nope/x", find(home));
assert.equal(r.model?.id, "anthropic/claude-haiku-4.5");
assert.match(r.reason, /not found/);
// No haiku: current model.
assert.equal(pickModel([cur], cur, undefined, find([cur])).model, cur);
// Provider tie-break prefers current provider.
const two = [m("a", "claude-haiku-4.5"), m("b", "claude-haiku-4.5")];
assert.equal(pickModel(two, m("b", "x"), undefined, find(two)).model?.provider, "b");

// lastExchange: finds last assistant + preceding user, caps length, keeps assistant tail.
const msg = (role: string, text: string) => ({ type: "message", message: { role, content: [{ type: "text", text }] } });
const entries = [msg("user", "old q"), msg("assistant", "old a"), msg("user", "U".repeat(1500)), msg("assistant", "A".repeat(5000) + "END")];
const ex = lastExchange(entries);
assert.equal(ex.user.length, 1000);
assert.ok(ex.assistant.endsWith("END") && ex.user.length + ex.assistant.length <= 3001);
assert.deepEqual(lastExchange([]), { user: "", assistant: "" });

// buildUserMessage includes draft + folder, omits exchange block when empty.
const b = buildUserMessage("fix it", "proj", { user: "", assistant: "" });
assert.ok(b.includes("<draft>\nfix it\n</draft>") && b.includes("proj") && !b.includes("previous_user"));

// cleanOutput strips fences / draft tags.
assert.equal(cleanOutput("```\nGoal: x\n```"), "Goal: x");
assert.equal(cleanOutput("<draft>\nhello\n</draft>"), "hello");
assert.equal(cleanOutput("  plain  "), "plain");

console.log("prompt-sharpener: all unit tests passed");
